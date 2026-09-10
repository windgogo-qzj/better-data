from __future__ import annotations

from pathlib import Path

import polars as pl
from openpyxl import load_workbook

from better_data.models import ColumnProfile, DatasetProfile


def profile_dataset(path: Path, sample_rows: int) -> DatasetProfile:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame = pl.read_csv(
            path,
            n_rows=sample_rows,
            infer_schema_length=min(sample_rows, 5_000),
            ignore_errors=True,
            try_parse_dates=False,
        )
        warnings: list[str] = []
    elif suffix == ".xlsx":
        frame, warnings = _read_xlsx_sample(path, sample_rows)
    else:
        raise ValueError("仅支持 CSV 和 XLSX 文件")

    columns: list[ColumnProfile] = []
    row_count = frame.height
    for name in frame.columns:
        series = frame.get_column(name)
        missing_count = series.null_count()
        examples = [str(value) for value in series.drop_nulls().head(3).to_list()]
        columns.append(
            ColumnProfile(
                name=name,
                inferred_type=str(series.dtype),
                missing_count=missing_count,
                missing_rate=(missing_count / row_count) if row_count else 0,
                unique_count=series.n_unique(),
                examples=examples,
            )
        )

    return DatasetProfile(
        sampled_rows=row_count,
        column_count=frame.width,
        columns=columns,
        warnings=warnings,
    )


def _read_xlsx_sample(path: Path, sample_rows: int) -> tuple[pl.DataFrame, list[str]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    worksheet = workbook.active
    rows = worksheet.iter_rows(values_only=True)
    headers = next(rows, None)
    if not headers:
        raise ValueError("工作表为空")

    normalized_headers = [str(value).strip() if value is not None else "" for value in headers]
    if any(not value for value in normalized_headers):
        raise ValueError("工作表存在空表头，请先补充字段名")
    if len(set(normalized_headers)) != len(normalized_headers):
        raise ValueError("工作表存在重复表头，请先处理字段名冲突")

    values = []
    for index, row in enumerate(rows):
        if index >= sample_rows:
            break
        values.append(dict(zip(normalized_headers, row, strict=False)))
    workbook.close()
    return pl.DataFrame(values, infer_schema_length=min(len(values), 5_000)), [
        f"当前读取工作表：{worksheet.title}",
        "公式字段使用文件中保存的缓存结果",
    ]
