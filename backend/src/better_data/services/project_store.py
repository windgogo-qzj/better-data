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
    TrashedProjectRecord,
    RecommendationSelectionUpdate,
    PipelineConfig,
    PipelineRunRecord,
    EvaluationMode,
    EvaluationRecord,
    TaskType,
)
from better_data.services.analysis import (
    RecommendationConflictError,
    build_project_analysis,
    validate_enabled_recommendations,
)
from better_data.services.profiling import profile_dataset
from better_data.services.pipeline import run_preprocessing_pipeline
from better_data.services.evaluation import build_evaluation_and_exports


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
            except Exception as exc:
                raise ValueError(str(exc)) from exc
            self._write_record(project_root, record)
            return record
        except Exception:
            if project_root.exists():
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

    def list_trash(self) -> list[TrashedProjectRecord]:
        records: list[TrashedProjectRecord] = []
        trash_root = self._trash_root()
        if not trash_root.exists():
            return records
        for metadata in trash_root.glob("*/project.json"):
            try:
                project = ProjectRecord.model_validate_json(
                    metadata.read_text(encoding="utf-8")
                )
                payload = json.loads(
                    (metadata.parent / "trash.json").read_text(encoding="utf-8")
                )
                records.append(
                    TrashedProjectRecord(
                        **project.model_dump(),
                        trashed_at=datetime.fromisoformat(payload["trashed_at"]),
                    )
                )
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
        return sorted(records, key=lambda item: item.trashed_at, reverse=True)

    def trash(self, project_id: str) -> TrashedProjectRecord:
        project = self.get(project_id)
        if project.status == ProjectStatus.PROCESSING:
            raise ValueError("项目正在处理中，完成后才能删除")

        project_root = self._project_root(project_id)
        trash_root = self._trash_root()
        destination = self._trashed_project_root(project_id)
        if destination.exists():
            raise ValueError("回收站中已存在同名项目")
        trash_root.mkdir(exist_ok=True)

        trashed_at = datetime.now(UTC)
        trash_metadata = project_root / "trash.json"
        self._write_json_atomic(
            trash_metadata,
            {"schema_version": 1, "trashed_at": trashed_at.isoformat()},
        )
        try:
            self._move_directory(project_root, destination)
        except Exception:
            trash_metadata.unlink(missing_ok=True)
            raise
        return TrashedProjectRecord(**project.model_dump(), trashed_at=trashed_at)

    def restore(self, project_id: str) -> ProjectRecord:
        source = self._trashed_project_root(project_id)
        metadata = source / "project.json"
        if not metadata.is_file():
            raise KeyError(project_id)
        try:
            project = ProjectRecord.model_validate_json(
                metadata.read_text(encoding="utf-8")
            )
        except (OSError, ValueError) as exc:
            raise ValueError("项目元数据损坏，无法恢复") from exc

        destination = self._project_root(project_id)
        if destination.exists():
            raise ValueError("项目库中已存在同名项目，无法恢复")
        self._move_directory(source, destination)
        (destination / "trash.json").unlink(missing_ok=True)
        return project

    def delete_permanently(self, project_id: str) -> None:
        project_root = self._trashed_project_root(project_id)
        if not (project_root / "project.json").is_file():
            raise KeyError(project_id)
        shutil.rmtree(project_root)

    def get_analysis(self, project_id: str) -> ProjectAnalysis:
        project = self.get(project_id)
        if project.status not in {ProjectStatus.READY, ProjectStatus.PROCESSED} or project.profile is None:
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
        self._invalidate_pipeline(project_id)
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
        self._invalidate_pipeline(project_id)
        return analysis

    def run_pipeline(self, project_id: str, config: PipelineConfig) -> PipelineRunRecord:
        project = self.get(project_id)
        analysis = self.get_analysis(project_id)
        project_root = self._project_root(project_id)
        source_path = project_root / "source" / project.source_filename
        if not source_path.is_file():
            raise ValueError("项目原始文件不存在")
        result = run_preprocessing_pipeline(
            project,
            analysis,
            source_path,
            project_root / "working",
            config,
        )
        self._invalidate_results(project_root)
        self._write_json_atomic(
            project_root / "pipeline-config.json", config.model_dump(mode="json")
        )
        project.status = ProjectStatus.PROCESSED
        project.error = None
        self._write_record(project_root, project)
        return result

    def create_evaluation(
        self, project_id: str, mode: EvaluationMode
    ) -> EvaluationRecord:
        project = self.get(project_id)
        analysis = self.get_analysis(project_id)
        pipeline_run = self.get_pipeline_run(project_id)
        project_root = self._project_root(project_id)
        return build_evaluation_and_exports(
            project, analysis, pipeline_run, project_root, mode
        )

    def get_evaluation(self, project_id: str) -> EvaluationRecord:
        self.get(project_id)
        path = self._project_root(project_id) / "results" / "evaluation.json"
        if not path.is_file():
            raise KeyError("evaluation")
        try:
            return EvaluationRecord.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("评估记录损坏，无法读取") from exc

    def artifact_path(self, project_id: str, artifact_name: str) -> tuple[Path, str]:
        project_root = self._project_root(project_id)
        self.get(project_id)
        allowed = {
            "train-csv": (project_root / "exports" / "train.csv", "train.csv"),
            "test-csv": (project_root / "exports" / "test.csv", "test.csv"),
            "processed-csv": (project_root / "exports" / "processed.csv", "processed.csv"),
            "report": (project_root / "reports" / "report.html", "better-data-report.html"),
        }
        if artifact_name not in allowed:
            raise KeyError(artifact_name)
        path, filename = allowed[artifact_name]
        resolved = path.resolve()
        self._assert_inside_library(resolved)
        if not resolved.is_file():
            raise KeyError(artifact_name)
        return resolved, filename

    def get_pipeline_run(self, project_id: str) -> PipelineRunRecord:
        self.get(project_id)
        state_file = self._project_root(project_id) / "working" / "pipeline-state.json"
        if not state_file.is_file():
            raise KeyError("pipeline-run")
        try:
            return PipelineRunRecord.model_validate_json(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("流水线运行记录损坏，无法读取") from exc

    def _invalidate_pipeline(self, project_id: str) -> None:
        project_root = self._project_root(project_id)
        for path in (
            project_root / "pipeline-config.json",
            project_root / "working" / "pipeline-state.json",
            project_root / "working" / "train.parquet",
            project_root / "working" / "test.parquet",
            project_root / "working" / "train-raw.parquet",
            project_root / "working" / "test-raw.parquet",
            project_root / "working" / "target-missing.parquet",
            project_root / "working" / "processed.parquet",
        ):
            path.unlink(missing_ok=True)
        self._invalidate_results(project_root)
        project = self.get(project_id)
        if project.status == ProjectStatus.PROCESSED:
            project.status = ProjectStatus.READY
            self._write_record(project_root, project)

    @staticmethod
    def _invalidate_results(project_root: Path) -> None:
        for path in (
            project_root / "results" / "evaluation.json",
            project_root / "reports" / "report.html",
            project_root / "exports" / "train.csv",
            project_root / "exports" / "test.csv",
            project_root / "exports" / "processed.csv",
        ):
            path.unlink(missing_ok=True)

    def _project_root(self, project_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", project_id):
            raise KeyError(project_id)
        project_root = (self.root / project_id).resolve()
        self._assert_inside_library(project_root)
        return project_root

    def _trash_root(self) -> Path:
        trash_root = (self.root / ".trash").resolve()
        self._assert_inside_library(trash_root)
        return trash_root

    def _trashed_project_root(self, project_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", project_id):
            raise KeyError(project_id)
        project_root = (self._trash_root() / project_id).resolve()
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

    @staticmethod
    def _move_directory(source: Path, destination: Path) -> None:
        try:
            source.replace(destination)
            return
        except PermissionError:
            # Some Windows hosts deny renaming a directory into/out of the hidden
            # .trash folder even though copying and removing its contents is allowed.
            pass

        try:
            shutil.copytree(source, destination)
            shutil.rmtree(source)
        except Exception:
            # If the source still exists, it remains the authoritative copy. Remove
            # any partial destination so a later retry is not blocked by a ghost item.
            if source.exists() and destination.exists():
                shutil.rmtree(destination, ignore_errors=True)
            raise

    def _assert_inside_library(self, path: Path) -> None:
        if path == self.root or self.root not in path.parents:
            raise ValueError("项目路径超出项目库范围")

    @staticmethod
    def _safe_filename(filename: str) -> str:
        cleaned = re.sub(r"[^\w.\-()\u4e00-\u9fff]", "_", filename, flags=re.UNICODE)
        return cleaned[:180] or "dataset"
