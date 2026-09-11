from __future__ import annotations

import csv
import io
from pathlib import Path

import polars as pl
from openpyxl import load_workbook
from polars.exceptions import PolarsError

from better_data.models import ColumnProfile, DatasetProfile


def profile_dataset(path: Path, sample_rows: int) -> DatasetProfile:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame, is_sampled, warnings = _read_csv_sample(path, sample_rows)
    elif suffix == ".xlsx":
        frame, is_sampled, warnings = _read_xlsx_sample(path, sample_rows)
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
        is_sampled=is_sampled,
        column_count=frame.width,
        columns=columns,
        preview_rows=_preview_rows(frame),
        warnings=warnings,
    )


def _read_csv_sample(path: Path, sample_rows: int) -> tuple[pl.DataFrame, bool, list[str]]:
    if sample_rows < 1:
        raise ValueError("画像抽样行数必须大于 0")

    with path.open("rb") as source:
        byte_sample = source.read(128 * 1024)
    text_encoding, polars_encoding = _detect_csv_encoding(byte_sample)
    text_sample = byte_sample.decode(text_encoding)

    if not text_sample.strip():
        raise ValueError("CSV 文件为空")

    delimiter = _detect_delimiter(text_sample)
    reader = csv.reader(io.StringIO(text_sample), delimiter=delimiter)
    headers = next(reader, None)
    _validate_headers(headers)

    try:
        sampled_frame = pl.read_csv(
            path,
            n_rows=sample_rows + 1,
            separator=delimiter,
            infer_schema_length=min(sample_rows, 5_000),
            ignore_errors=False,
            try_parse_dates=False,
            encoding=polars_encoding,
        )
    except PolarsError as exc:
        raise ValueError(f"CSV 无法解析，请检查分隔符、引号和每行列数：{exc}") from exc

    if sampled_frame.width == 0:
        raise ValueError("CSV 没有可用字段")

    is_sampled = sampled_frame.height > sample_rows
    frame = sampled_frame.head(sample_rows)
    warnings = [f"数据画像基于前 {sample_rows:,} 行抽样"] if is_sampled else []
    if polars_encoding != "utf8":
        warnings.append(f"检测到 CSV 编码：{text_encoding.upper()}")
    if delimiter != ",":
        visible_delimiter = "TAB" if delimiter == "\t" else delimiter
        warnings.append(f"检测到字段分隔符：{visible_delimiter}")
    return frame, is_sampled, warnings


def _detect_csv_encoding(byte_sample: bytes) -> tuple[str, str]:
    """Return a safe text decoder and the matching Polars CSV encoding.

    UTF-8 remains the default. GB18030 is selected only when the decoded sample
    contains a meaningful amount of CJK text; this avoids interpreting ordinary
    Western punctuation as Chinese. Windows-1252 covers common exports from
    desktop spreadsheet tools.
    """
    try:
        byte_sample.decode("utf-8-sig")
        return "utf-8-sig", "utf8"
    except UnicodeDecodeError:
        pass

    try:
        gb18030_text = byte_sample.decode("gb18030")
        visible_count = sum(character.isalnum() for character in gb18030_text)
        cjk_count = sum("\u3400" <= character <= "\u9fff" for character in gb18030_text)
        if cjk_count >= 2 and cjk_count / max(visible_count, 1) >= 0.02:
            return "gb18030", "gb18030"
    except UnicodeDecodeError:
        gb18030_text = ""

    try:
        byte_sample.decode("windows-1252")
        return "windows-1252", "windows-1252"
    except UnicodeDecodeError:
        if gb18030_text:
            return "gb18030", "gb18030"
        raise ValueError(
            "无法识别 CSV 编码，请另存为 UTF-8、GB18030 或 Windows-1252"
        ) from None


def _detect_delimiter(text_sample: str) -> str:
    try:
        return csv.Sniffer().sniff(text_sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _validate_headers(headers: list[str] | None) -> None:
    if not headers:
        raise ValueError("CSV 没有表头")
    normalized = [value.strip() for value in headers]
    if any(not value for value in normalized):
        raise ValueError("CSV 存在空表头，请先补充字段名")
    if len(set(normalized)) != len(normalized):
        raise ValueError("CSV 存在重复表头，请先处理字段名冲突")


def _read_xlsx_sample(path: Path, sample_rows: int) -> tuple[pl.DataFrame, bool, list[str]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
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
            if index > sample_rows:
                break
            values.append(dict(zip(normalized_headers, row, strict=False)))
        is_sampled = len(values) > sample_rows
        frame = pl.DataFrame(values[:sample_rows], infer_schema_length=min(len(values), 5_000))
        warnings = [
            f"当前读取工作表：{worksheet.title}",
            "公式字段使用文件中保存的缓存结果",
        ]
        if is_sampled:
            warnings.append(f"数据画像基于前 {sample_rows:,} 行抽样")
        return frame, is_sampled, warnings
    finally:
        workbook.close()


def _preview_rows(frame: pl.DataFrame, limit: int = 5) -> list[dict[str, str | None]]:
    preview: list[dict[str, str | None]] = []
    for row in frame.head(limit).iter_rows(named=True):
        preview.append({name: None if value is None else str(value) for name, value in row.items()})
    return preview
