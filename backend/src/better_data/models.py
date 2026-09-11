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
    PROCESSING = "processing"
    PROCESSED = "processed"
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


class TrashedProjectRecord(ProjectRecord):
    trashed_at: datetime


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


class NumericImputation(StrEnum):
    MEAN = "mean"
    MEDIAN = "median"


class CategoricalImputation(StrEnum):
    MOST_FREQUENT = "most_frequent"
    MISSING_CATEGORY = "missing_category"


class ScalingStrategy(StrEnum):
    NONE = "none"
    STANDARD = "standard"
    MINMAX = "minmax"


class PipelineConfig(BaseModel):
    schema_version: int = 1
    test_size: float = Field(default=0.2, ge=0.1, le=0.5)
    random_seed: int = Field(default=42, ge=0, le=2_147_483_647)
    stratify_classification: bool = True
    drop_duplicates: bool = True
    drop_constant_features: bool = True
    numeric_imputation: NumericImputation = NumericImputation.MEDIAN
    categorical_imputation: CategoricalImputation = CategoricalImputation.MOST_FREQUENT
    scaling: ScalingStrategy = ScalingStrategy.STANDARD
    max_categories: int = Field(default=50, ge=2, le=500)


class PipelineRunRequest(BaseModel):
    config: PipelineConfig = Field(default_factory=PipelineConfig)


class PipelineArtifact(BaseModel):
    path: str
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    sha256: str


class PipelineRunRecord(BaseModel):
    schema_version: int = 1
    project_id: str
    source_sha256: str
    created_at: datetime
    config: PipelineConfig
    target_column: str | None
    feature_columns: list[str]
    output_feature_columns: list[str]
    applied_recommendation_ids: list[str]
    train_rows: int
    test_rows: int
    full_rows: int = 0
    target_missing_rows: int
    stratified: bool
    learned_parameters: dict[str, dict[str, object]]
    test_unknown_categories: dict[str, int]
    artifacts: dict[str, PipelineArtifact]


class EvaluationMode(StrEnum):
    OFF = "off"
    QUICK = "quick"


class EvaluationRequest(BaseModel):
    mode: EvaluationMode = EvaluationMode.QUICK


class EvaluationScores(BaseModel):
    name: str
    metrics: dict[str, float]


class ExportArtifact(BaseModel):
    path: str
    download_url: str
    size: int = Field(ge=0)
    sha256: str


class EvaluationRecord(BaseModel):
    schema_version: int = 1
    project_id: str
    source_sha256: str
    created_at: datetime
    mode: EvaluationMode
    task_type: TaskType
    random_seed: int
    same_split: bool
    train_rows: int
    test_rows: int
    full_rows: int = 0
    baseline: EvaluationScores | None = None
    complete: EvaluationScores | None = None
    artifacts: dict[str, ExportArtifact]


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
