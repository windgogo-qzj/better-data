from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
from polars.exceptions import PolarsError
from sklearn.model_selection import train_test_split

from better_data.models import (
    CategoricalImputation,
    ColumnRole,
    FieldRole,
    NumericImputation,
    PipelineArtifact,
    PipelineConfig,
    PipelineRunRecord,
    ProjectAnalysis,
    ProjectRecord,
    ScalingStrategy,
    TaskType,
)

NUMERIC_ROLES = {ColumnRole.CONTINUOUS_NUMERIC, ColumnRole.DISCRETE_NUMERIC}
CATEGORICAL_ROLES = {
    ColumnRole.NOMINAL_CATEGORY,
    ColumnRole.ORDINAL_CATEGORY,
    ColumnRole.BOOLEAN,
}
EXCLUDED_ROLES = {
    ColumnRole.ID,
    ColumnRole.TEXT,
    ColumnRole.GROUP,
    ColumnRole.SENSITIVE,
    ColumnRole.IGNORE,
}


def run_preprocessing_pipeline(
    project: ProjectRecord,
    analysis: ProjectAnalysis,
    source_path: Path,
    working_dir: Path,
    config: PipelineConfig,
) -> PipelineRunRecord:
    if project.task_type not in {TaskType.CLASSIFICATION, TaskType.REGRESSION}:
        raise ValueError("MVP 安全流水线仅支持分类和回归任务")
    if not analysis.fields_confirmed:
        raise ValueError("请先确认字段角色，再运行预处理流水线")
    if source_path.suffix.lower() != ".csv":
        raise ValueError("MVP 安全流水线当前仅支持 CSV；XLSX 全量处理将在 Beta 提供")

    target_fields = [field for field in analysis.fields if field.role == ColumnRole.TARGET]
    if len(target_fields) != 1:
        raise ValueError("分类和回归任务必须且只能有一个目标列")
    target = target_fields[0].name
    enabled_recommendations = [item for item in analysis.recommendations if item.enabled]
    excluded_by_rule = {
        item.column
        for item in enabled_recommendations
        if item.column and item.action in {"remove_column", "exclude_feature"}
    }
    indicator_fields = {
        item.column
        for item in enabled_recommendations
        if item.column and item.action == "add_missing_indicator"
    }
    feature_fields = [
        field
        for field in analysis.fields
        if field.role not in EXCLUDED_ROLES and field.role != ColumnRole.TARGET
        and field.name not in excluded_by_rule
    ]
    unsupported = [
        field.name
        for field in feature_fields
        if field.role not in NUMERIC_ROLES | CATEGORICAL_ROLES
    ]
    if unsupported:
        raise ValueError(f"MVP 流水线暂不支持这些字段角色：{', '.join(unsupported)}")
    if not feature_fields:
        raise ValueError("没有可用于预处理的特征字段")

    frame = _read_csv(source_path)
    expected = {field.name for field in analysis.fields}
    if set(frame.columns) != expected:
        raise ValueError("源文件结构与已确认字段不一致，请重新导入项目")
    if config.drop_duplicates:
        frame = frame.unique(maintain_order=True)

    target_missing = frame.filter(pl.col(target).is_null())
    eligible = frame.filter(pl.col(target).is_not_null())
    if eligible.height < 5:
        raise ValueError("去除缺失目标后至少需要 5 行数据才能划分训练集和测试集")

    stratify_values: list[object] | None = None
    if project.task_type == TaskType.CLASSIFICATION:
        target_values = eligible.get_column(target).to_list()
        counts = Counter(target_values)
        if len(counts) < 2:
            raise ValueError("分类目标至少需要两个类别")
        if config.stratify_classification:
            if min(counts.values()) < 2:
                raise ValueError("分层划分要求每个目标类别至少有 2 行")
            stratify_values = target_values
    else:
        _strict_numeric(eligible.get_column(target), target)

    indices = list(range(eligible.height))
    try:
        train_indices, test_indices = train_test_split(
            indices,
            test_size=config.test_size,
            random_state=config.random_seed,
            shuffle=True,
            stratify=stratify_values,
        )
    except ValueError as exc:
        raise ValueError(f"无法按当前测试集比例完成安全划分：{exc}") from exc
    train_raw = eligible.gather(train_indices)
    test_raw = eligible.gather(test_indices)

    train_columns: dict[str, pl.Series] = {}
    test_columns: dict[str, pl.Series] = {}
    learned: dict[str, dict[str, object]] = {}
    unknown_counts: dict[str, int] = {}
    output_features: list[str] = []

    for field in feature_fields:
        if field.role in NUMERIC_ROLES:
            _transform_numeric(
                field,
                train_raw,
                test_raw,
                config,
                train_columns,
                test_columns,
                learned,
                output_features,
            )
        else:
            _transform_categorical(
                field,
                train_raw,
                test_raw,
                config,
                train_columns,
                test_columns,
                learned,
                unknown_counts,
                output_features,
            )
        if field.name in indicator_fields:
            indicator_name = f"{field.name}__is_missing"
            train_columns[indicator_name] = train_raw.get_column(field.name).is_null().cast(pl.Int8).rename(indicator_name)
            test_columns[indicator_name] = test_raw.get_column(field.name).is_null().cast(pl.Int8).rename(indicator_name)
            output_features.append(indicator_name)
            learned.setdefault(field.name, {})["missing_indicator"] = indicator_name

    if not output_features:
        raise ValueError("训练集拟合后没有保留下来的特征")
    if len(output_features) != len(set(output_features)) or target in output_features:
        raise ValueError("处理后的特征名称发生冲突，请调整原始字段名后重新导入")
    train_columns[target] = train_raw.get_column(target)
    test_columns[target] = test_raw.get_column(target)
    train_result = pl.DataFrame(train_columns)
    test_result = pl.DataFrame(test_columns)

    working_dir.mkdir(parents=True, exist_ok=True)
    train_path = working_dir / "train.parquet"
    test_path = working_dir / "test.parquet"
    target_missing_path = working_dir / "target-missing.parquet"
    state_path = working_dir / "pipeline-state.json"
    _write_parquet_atomic(train_path, train_result)
    _write_parquet_atomic(test_path, test_result)
    _write_parquet_atomic(target_missing_path, target_missing)

    artifacts = {
        "train": _artifact(working_dir, train_path, train_result),
        "test": _artifact(working_dir, test_path, test_result),
        "target_missing": _artifact(working_dir, target_missing_path, target_missing),
    }
    record = PipelineRunRecord(
        project_id=project.id,
        source_sha256=project.source_sha256,
        created_at=datetime.now(UTC),
        config=config,
        target_column=target,
        feature_columns=[field.name for field in feature_fields],
        output_feature_columns=output_features,
        applied_recommendation_ids=sorted(item.id for item in enabled_recommendations),
        train_rows=train_result.height,
        test_rows=test_result.height,
        target_missing_rows=target_missing.height,
        stratified=stratify_values is not None,
        learned_parameters=learned,
        test_unknown_categories=unknown_counts,
        artifacts=artifacts,
    )
    _write_json_atomic(state_path, record.model_dump(mode="json"))
    return record


def _read_csv(path: Path) -> pl.DataFrame:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            sample = source.read(128 * 1024)
    except UnicodeDecodeError as exc:
        raise ValueError("CSV 必须使用 UTF-8 或 UTF-8 BOM 编码") from exc
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    headers = next(csv.reader(io.StringIO(sample), delimiter=delimiter), None)
    if not headers:
        raise ValueError("CSV 没有表头")
    try:
        return pl.read_csv(
            path,
            separator=delimiter,
            infer_schema_length=10_000,
            ignore_errors=False,
            try_parse_dates=False,
            encoding="utf8",
        )
    except PolarsError as exc:
        raise ValueError(f"CSV 全量读取失败：{exc}") from exc


def _transform_numeric(
    field: FieldRole,
    train: pl.DataFrame,
    test: pl.DataFrame,
    config: PipelineConfig,
    train_columns: dict[str, pl.Series],
    test_columns: dict[str, pl.Series],
    learned: dict[str, dict[str, object]],
    output_features: list[str],
) -> None:
    train_numeric = _strict_numeric(train.get_column(field.name), field.name)
    test_numeric = _strict_numeric(test.get_column(field.name), field.name)
    non_null = train_numeric.drop_nulls()
    if non_null.len() == 0:
        if config.drop_constant_features:
            learned[field.name] = {"kind": "numeric", "dropped": "all_missing_in_train"}
            return
        raise ValueError(f"数值字段 {field.name} 在训练集中全部缺失")
    fill_value = (
        non_null.mean()
        if config.numeric_imputation == NumericImputation.MEAN
        else non_null.median()
    )
    assert fill_value is not None
    train_filled = train_numeric.fill_null(float(fill_value))
    test_filled = test_numeric.fill_null(float(fill_value))
    if config.drop_constant_features and train_filled.n_unique() <= 1:
        learned[field.name] = {
            "kind": "numeric",
            "dropped": "constant_in_train",
            "fill_value": float(fill_value),
        }
        return

    state: dict[str, object] = {
        "kind": "numeric",
        "imputation": config.numeric_imputation.value,
        "fill_value": float(fill_value),
        "scaling": config.scaling.value,
    }
    if config.scaling == ScalingStrategy.STANDARD:
        center = float(train_filled.mean() or 0)
        scale = float(train_filled.std(ddof=0) or 1)
        if scale == 0:
            scale = 1
        train_filled = (train_filled - center) / scale
        test_filled = (test_filled - center) / scale
        state.update({"center": center, "scale": scale})
    elif config.scaling == ScalingStrategy.MINMAX:
        minimum = float(train_filled.min())
        maximum = float(train_filled.max())
        scale = maximum - minimum or 1
        train_filled = (train_filled - minimum) / scale
        test_filled = (test_filled - minimum) / scale
        state.update({"minimum": minimum, "maximum": maximum, "scale": scale})
    train_columns[field.name] = train_filled.rename(field.name)
    test_columns[field.name] = test_filled.rename(field.name)
    learned[field.name] = state
    output_features.append(field.name)


def _transform_categorical(
    field: FieldRole,
    train: pl.DataFrame,
    test: pl.DataFrame,
    config: PipelineConfig,
    train_columns: dict[str, pl.Series],
    test_columns: dict[str, pl.Series],
    learned: dict[str, dict[str, object]],
    unknown_counts: dict[str, int],
    output_features: list[str],
) -> None:
    train_values = _categorical_values(train.get_column(field.name))
    test_values = _categorical_values(test.get_column(field.name))
    observed = [value for value in train_values if value is not None]
    if config.categorical_imputation == CategoricalImputation.MOST_FREQUENT:
        if not observed:
            fill_value = "__MISSING__"
        else:
            fill_value = Counter(observed).most_common(1)[0][0]
    else:
        fill_value = "__MISSING__"
    train_filled = [fill_value if value is None else value for value in train_values]
    test_filled = [fill_value if value is None else value for value in test_values]
    counts = Counter(train_filled)
    categories = [
        value
        for value, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[
            : config.max_categories
        ]
    ]
    if config.drop_constant_features and len(categories) <= 1 and len(counts) <= 1:
        learned[field.name] = {
            "kind": "categorical",
            "dropped": "constant_in_train",
            "fill_value": fill_value,
        }
        return
    category_set = set(categories)
    for index, category in enumerate(categories):
        output_name = f"{field.name}__category_{index:03d}"
        train_columns[output_name] = pl.Series(
            output_name, [int(value == category) for value in train_filled], dtype=pl.Int8
        )
        test_columns[output_name] = pl.Series(
            output_name, [int(value == category) for value in test_filled], dtype=pl.Int8
        )
        output_features.append(output_name)
    unknown_name = f"{field.name}__unknown"
    train_columns[unknown_name] = pl.Series(
        unknown_name, [int(value not in category_set) for value in train_filled], dtype=pl.Int8
    )
    test_unknown = [int(value not in category_set) for value in test_filled]
    test_columns[unknown_name] = pl.Series(unknown_name, test_unknown, dtype=pl.Int8)
    output_features.append(unknown_name)
    unknown_counts[field.name] = sum(test_unknown)
    learned[field.name] = {
        "kind": "categorical",
        "imputation": config.categorical_imputation.value,
        "fill_value": fill_value,
        "categories": categories,
        "truncated": len(counts) > len(categories),
        "unknown_output": unknown_name,
    }


def _strict_numeric(series: pl.Series, name: str) -> pl.Series:
    casted = series.cast(pl.Float64, strict=False)
    introduced_nulls = casted.null_count() - series.null_count()
    if introduced_nulls > 0:
        raise ValueError(f"数值字段 {name} 有 {introduced_nulls} 个值无法解析")
    return casted


def _categorical_values(series: pl.Series) -> list[str | None]:
    return [None if value is None else str(value).strip() for value in series.to_list()]


def _artifact(root: Path, path: Path, frame: pl.DataFrame) -> PipelineArtifact:
    return PipelineArtifact(
        path=str(path.relative_to(root)).replace("\\", "/"),
        row_count=frame.height,
        column_count=frame.width,
        sha256=_sha256(path),
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, payload: object) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _write_parquet_atomic(path: Path, frame: pl.DataFrame) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    try:
        frame.write_parquet(temporary)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
