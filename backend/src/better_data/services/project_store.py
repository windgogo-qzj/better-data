from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from better_data.config import Settings
from better_data.models import ProjectRecord, ProjectStatus, TaskType
from better_data.services.profiling import profile_dataset


class ProjectStore:
    def __init__(self, app_settings: Settings) -> None:
        self.settings = app_settings
        self.root = app_settings.project_library

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    async def create(self, name: str, task_type: TaskType, upload: UploadFile) -> ProjectRecord:
        filename = Path(upload.filename or "").name
        suffix = Path(filename).suffix.lower()
        if suffix not in {".csv", ".xlsx"}:
            raise ValueError("仅支持 CSV 和 XLSX 文件")

        limit = self.settings.max_csv_bytes if suffix == ".csv" else self.settings.max_xlsx_bytes
        project_id = uuid4().hex
        project_root = (self.root / project_id).resolve()
        self._assert_inside_library(project_root)
        source_dir = project_root / "source"
        source_dir.mkdir(parents=True)
        for folder in ("working", "results", "reports", "exports", "logs"):
            (project_root / folder).mkdir()

        safe_filename = self._safe_filename(filename)
        destination = source_dir / safe_filename
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError(f"{suffix[1:].upper()} 文件超过允许大小")
                    digest.update(chunk)
                    target.write(chunk)

            record = ProjectRecord(
                id=project_id,
                name=name.strip() or Path(filename).stem,
                task_type=task_type,
                status=ProjectStatus.PROFILING,
                source_filename=safe_filename,
                source_size=size,
                source_sha256=digest.hexdigest(),
                created_at=datetime.now(UTC),
            )
            self._write_record(project_root, record)

            try:
                record.profile = profile_dataset(destination, self.settings.profile_sample_rows)
                record.status = ProjectStatus.READY
            except Exception as exc:  # project remains inspectable after a profiling failure
                record.status = ProjectStatus.FAILED
                record.error = str(exc)
            self._write_record(project_root, record)
            return record
        except Exception:
            if project_root.exists() and not (project_root / "project.json").exists():
                shutil.rmtree(project_root)
            raise
        finally:
            await upload.close()

    def list(self) -> list[ProjectRecord]:
        records: list[ProjectRecord] = []
        if not self.root.exists():
            return records
        for metadata in self.root.glob("*/project.json"):
            try:
                records.append(ProjectRecord.model_validate_json(metadata.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def _write_record(self, project_root: Path, record: ProjectRecord) -> None:
        metadata = project_root / "project.json"
        temporary = project_root / "project.json.tmp"
        temporary.write_text(json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(metadata)

    def _assert_inside_library(self, path: Path) -> None:
        if path == self.root or self.root not in path.parents:
            raise ValueError("项目路径超出项目库范围")

    @staticmethod
    def _safe_filename(filename: str) -> str:
        cleaned = re.sub(r"[^\w.\-()\u4e00-\u9fff]", "_", filename, flags=re.UNICODE)
        return cleaned[:180] or "dataset"
