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


class ColumnRole(StrEnum):
    CONTINUOUS_NUMERIC = "continuous_numeric"
    DISCRETE_NUMERIC = "discrete_numeric"
    NOMINAL_CATEGORY = "nominal_category"
    ORDINAL_CATEGORY = "ordinal_category"
    BOOLEAN = "boolean"
    DATETIME = "datetime"
    ID = "id"
    TEXT = "text"
    TARGET = "target"
    GROUP = "group"
    SENSITIVE = "sensitive"
    IGNORE = "ignore"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ColumnProfile(BaseModel):
    name: str
    inferred_type: str
    missing_count: int
    missing_rate: float = Field(ge=0, le=1)
    unique_count: int
    examples: list[str]


class DatasetProfile(BaseModel):
    sampled_rows: int
    is_sampled: bool
    column_count: int
    columns: list[ColumnProfile]
    preview_rows: list[dict[str, str | None]]
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


class FieldRole(BaseModel):
    name: str
    role: ColumnRole
    inferred_type: str


class FieldRoleUpdate(BaseModel):
    name: str
    role: ColumnRole


class FieldConfigurationUpdate(BaseModel):
    fields: list[FieldRoleUpdate] = Field(min_length=1)


class QualityDeduction(BaseModel):
    rule_id: str
    column: str | None = None
    points: int = Field(ge=0, le=100)
    reason: str
    evidence: str


class QualityDimension(BaseModel):
    key: str
    label: str
    score: int = Field(ge=0, le=100)
    deductions: list[QualityDeduction] = Field(default_factory=list)


class QualityReport(BaseModel):
    total_score: int = Field(ge=0, le=100)
    sampled: bool
    dimensions: list[QualityDimension]


class RuleRecommendation(BaseModel):
    id: str
    rule_id: str
    title: str
    column: str | None = None
    problem: str
    evidence: str
    severity: RiskLevel
    risk: RiskLevel
    confidence: float = Field(ge=0, le=1)
    action: str
    parameters: dict[str, str | int | float | bool] = Field(default_factory=dict)
    expected_impact: str
    side_effects: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    enabled: bool = False
    conflicts_with: list[str] = Field(default_factory=list)


class RecommendationSelectionUpdate(BaseModel):
    enabled_ids: list[str]


class ProjectAnalysis(BaseModel):
    schema_version: int = 1
    project_id: str
    fields: list[FieldRole]
    quality: QualityReport
    recommendations: list[RuleRecommendation]
    fields_confirmed: bool = False


class HealthResponse(BaseModel):
    status: str
    version: str
    offline: bool


class ProjectLibraryUpdate(BaseModel):
    path: str = Field(min_length=1, max_length=1_024)


class ProjectLibraryInfo(BaseModel):
    path: str
    exists: bool
    writable: bool
    project_count: int
    needs_setup: bool
