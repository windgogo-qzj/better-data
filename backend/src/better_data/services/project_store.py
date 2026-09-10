from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from better_data.config import Settings
from better_data.models import (
    ColumnRole,
    FieldConfigurationUpdate,
    ProjectAnalysis,
    ProjectRecord,
    ProjectStatus,
    RecommendationSelectionUpdate,
    TaskType,
)
from better_data.services.analysis import (
    RecommendationConflictError,
    build_project_analysis,
    validate_enabled_recommendations,
)
from better_data.services.profiling import profile_dataset


class ProjectStore:
    def __init__(self, app_settings: Settings) -> None:
        self.settings = app_settings
        self.root = app_settings.project_library
        self.config_file = app_settings.config_file or self.root.parent / "app-settings.json"
        self.needs_setup = not app_settings.project_library_configured

    def initialize(self) -> None:
        saved_library = self._load_saved_library()
        if saved_library is not None:
            self.root = saved_library
            self.needs_setup = False
        elif self._has_projects(self.root):
            self.needs_setup = False
        self._initialize_library(self.root, allow_legacy=True)

    def library_info(self) -> dict[str, object]:
        return {
            "path": str(self.root),
            "exists": self.root.is_dir(),
            "writable": self.root.is_dir() and os.access(self.root, os.W_OK),
            "project_count": len(self.list()),
            "needs_setup": self.needs_setup,
        }

    def set_library(self, raw_path: str) -> dict[str, object]:
        path = Path(raw_path.strip()).expanduser()
        if not path.is_absolute():
            raise ValueError("项目库必须使用绝对路径")
        candidate = path.resolve()
        if candidate.exists() and not candidate.is_dir():
            raise ValueError("项目库路径必须是文件夹")

        self._initialize_library(candidate, allow_legacy=False)
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        self._write_json_atomic(
            self.config_file,
            {"schema_version": 1, "project_library": str(candidate)},
        )
        self.root = candidate
        self.needs_setup = False
        return self.library_info()

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
                self._write_analysis(project_root, build_project_analysis(record))
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

    def get(self, project_id: str) -> ProjectRecord:
        project_root = self._project_root(project_id)
        metadata = project_root / "project.json"
        if not metadata.is_file():
            raise KeyError(project_id)
        try:
            return ProjectRecord.model_validate_json(metadata.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("项目元数据损坏，无法读取") from exc

    def get_analysis(self, project_id: str) -> ProjectAnalysis:
        project = self.get(project_id)
        if project.status != ProjectStatus.READY or project.profile is None:
            raise ValueError("项目尚未完成数据画像，无法确认字段")
        project_root = self._project_root(project_id)
        analysis_file = project_root / "analysis.json"
        if analysis_file.is_file():
            try:
                return ProjectAnalysis.model_validate_json(analysis_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        analysis = build_project_analysis(project)
        self._write_analysis(project_root, analysis)
        return analysis

    def update_fields(
        self, project_id: str, update: FieldConfigurationUpdate
    ) -> ProjectAnalysis:
        project = self.get(project_id)
        if project.profile is None:
            raise ValueError("项目尚未生成可用的数据画像")
        expected_names = [column.name for column in project.profile.columns]
        provided_names = [field.name for field in update.fields]
        if len(provided_names) != len(set(provided_names)):
            raise ValueError("字段配置中包含重复字段")
        missing = set(expected_names) - set(provided_names)
        unknown = set(provided_names) - set(expected_names)
        if missing or unknown:
            details = []
            if missing:
                details.append(f"缺少字段：{', '.join(sorted(missing))}")
            if unknown:
                details.append(f"未知字段：{', '.join(sorted(unknown))}")
            raise ValueError("；".join(details))

        roles = {field.name: field.role for field in update.fields}
        target_count = sum(role == ColumnRole.TARGET for role in roles.values())
        if project.task_type in {TaskType.CLASSIFICATION, TaskType.REGRESSION} and target_count != 1:
            raise ValueError("分类和回归任务必须且只能指定一个目标列")
        if project.task_type in {TaskType.CLEANING, TaskType.CLUSTERING_PREP} and target_count:
            raise ValueError("纯清洗和聚类预处理任务不使用目标列")

        previous = self.get_analysis(project_id)
        enabled_ids = {item.id for item in previous.recommendations if item.enabled}
        analysis = build_project_analysis(
            project,
            saved_roles=roles,
            enabled_ids=enabled_ids,
            fields_confirmed=True,
        )
        validate_enabled_recommendations(
            analysis.recommendations,
            {item.id for item in analysis.recommendations if item.enabled},
        )
        self._write_analysis(self._project_root(project_id), analysis)
        return analysis

    def update_recommendations(
        self, project_id: str, update: RecommendationSelectionUpdate
    ) -> ProjectAnalysis:
        analysis = self.get_analysis(project_id)
        enabled_ids = set(update.enabled_ids)
        if len(update.enabled_ids) != len(enabled_ids):
            raise ValueError("启用建议列表中包含重复项")
        validate_enabled_recommendations(analysis.recommendations, enabled_ids)
        for recommendation in analysis.recommendations:
            recommendation.enabled = recommendation.id in enabled_ids
        self._write_analysis(self._project_root(project_id), analysis)
        return analysis

    def _project_root(self, project_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", project_id):
            raise KeyError(project_id)
        project_root = (self.root / project_id).resolve()
        self._assert_inside_library(project_root)
        return project_root

    def _write_record(self, project_root: Path, record: ProjectRecord) -> None:
        self._write_json_atomic(project_root / "project.json", record.model_dump(mode="json"))

    def _write_analysis(self, project_root: Path, analysis: ProjectAnalysis) -> None:
        self._write_json_atomic(project_root / "analysis.json", analysis.model_dump(mode="json"))

    def _load_saved_library(self) -> Path | None:
        if not self.config_file.is_file():
            return None
        try:
            payload = json.loads(self.config_file.read_text(encoding="utf-8"))
            if payload.get("schema_version") != 1:
                return None
            saved_path = Path(payload["project_library"])
            return saved_path.resolve() if saved_path.is_absolute() else None
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def _initialize_library(self, root: Path, *, allow_legacy: bool) -> None:
        root.mkdir(parents=True, exist_ok=True)
        marker = root / ".better-data-library.json"
        existing = [item for item in root.iterdir() if item.name != marker.name]
        if existing and not marker.is_file():
            is_legacy = allow_legacy and self._has_projects(root)
            if not is_legacy:
                raise ValueError("所选文件夹不是空文件夹，也不是已有的 Better Data 项目库")
        if not marker.exists():
            self._write_json_atomic(
                marker,
                {
                    "schema_version": 1,
                    "kind": "better-data-project-library",
                    "created_at": datetime.now(UTC).isoformat(),
                },
            )

    @staticmethod
    def _has_projects(root: Path) -> bool:
        return root.is_dir() and any(root.glob("*/project.json"))

    @staticmethod
    def _write_json_atomic(path: Path, payload: object) -> None:
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _assert_inside_library(self, path: Path) -> None:
        if path == self.root or self.root not in path.parents:
            raise ValueError("项目路径超出项目库范围")

    @staticmethod
    def _safe_filename(filename: str) -> str:
        cleaned = re.sub(r"[^\w.\-()\u4e00-\u9fff]", "_", filename, flags=re.UNICODE)
        return cleaned[:180] or "dataset"
