from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class TaskType(StrEnum):
    CLASSIFICATION = "classification"
    REGRESSION = "regression"
    CLUSTERING_PREP = "clustering_prep"
    CLEANING = "cleaning"


class ProjectStatus(StrEnum):
    UPLOADED = "uploaded"
    PROFILING = "profiling"
    READY = "ready"
    FAILED = "failed"


class ColumnProfile(BaseModel):
    name: str
    inferred_type: str
    missing_count: int
    missing_rate: float = Field(ge=0, le=1)
    unique_count: int
    examples: list[str]


class DatasetProfile(BaseModel):
    sampled_rows: int
    column_count: int
    columns: list[ColumnProfile]
    warnings: list[str] = Field(default_factory=list)


class ProjectRecord(BaseModel):
    id: str
    name: str
    task_type: TaskType
    status: ProjectStatus
    source_filename: str
    source_size: int
    source_sha256: str
    created_at: datetime
    profile: DatasetProfile | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    offline: bool
