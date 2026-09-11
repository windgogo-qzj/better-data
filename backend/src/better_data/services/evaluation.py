from __future__ import annotations

import hashlib
import html
import json
import math
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import polars as pl
from scipy import sparse
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.preprocessing import OneHotEncoder

from better_data.models import (
    ColumnRole,
    EvaluationMode,
    EvaluationRecord,
    EvaluationScores,
    ExportArtifact,
    PipelineRunRecord,
    ProjectAnalysis,
    ProjectRecord,
    TaskType,
)

NUMERIC_ROLES = {ColumnRole.CONTINUOUS_NUMERIC, ColumnRole.DISCRETE_NUMERIC}


def build_evaluation_and_exports(
    project: ProjectRecord,
    analysis: ProjectAnalysis,
    pipeline_run: PipelineRunRecord,
    project_root: Path,
    mode: EvaluationMode,
) -> EvaluationRecord:
    if project.task_type == TaskType.CLEANING:
        return _build_cleaning_exports(project, analysis, pipeline_run, project_root, mode)
    working = project_root / "working"
    raw_train = _read_required_parquet(working / "train-raw.parquet")
    raw_test = _read_required_parquet(working / "test-raw.parquet")
    complete_train = _read_required_parquet(working / "train.parquet")
    complete_test = _read_required_parquet(working / "test.parquet")
    target = pipeline_run.target_column
    if target is None:
        raise ValueError("监督学习评估缺少目标列记录")
    if raw_train.height != complete_train.height or raw_test.height != complete_test.height:
        raise ValueError("原始与处理后划分行数不一致，无法进行公平评估")
    if raw_train.get_column(target).to_list() != complete_train.get_column(target).to_list():
        raise ValueError("处理前后训练目标顺序不一致，已停止评估")
    if raw_test.get_column(target).to_list() != complete_test.get_column(target).to_list():
        raise ValueError("处理前后测试目标顺序不一致，已停止评估")

    baseline_scores: EvaluationScores | None = None
    complete_scores: EvaluationScores | None = None
    if mode == EvaluationMode.QUICK:
        baseline_train, baseline_test = _minimal_baseline(
            raw_train,
            raw_test,
            analysis,
            pipeline_run.feature_columns,
        )
        full_train = complete_train.select(pipeline_run.output_feature_columns).to_numpy()
        full_test = complete_test.select(pipeline_run.output_feature_columns).to_numpy()
        y_train = raw_train.get_column(target).to_numpy()
        y_test = raw_test.get_column(target).to_numpy()
        baseline_scores = _evaluate(
            project.task_type,
            baseline_train,
            baseline_test,
            y_train,
            y_test,
            pipeline_run.config.random_seed,
            "最低限度兼容方案",
        )
        complete_scores = _evaluate(
            project.task_type,
            full_train,
            full_test,
            y_train,
            y_test,
            pipeline_run.config.random_seed,
            "用户确认完整方案",
        )

    exports = project_root / "exports"
    reports = project_root / "reports"
    results = project_root / "results"
    for directory in (exports, reports, results):
        directory.mkdir(parents=True, exist_ok=True)
    train_csv = exports / "train.csv"
    test_csv = exports / "test.csv"
    report_html = reports / "report.html"
    result_json = results / "evaluation.json"
    _write_csv_atomic(train_csv, complete_train)
    _write_csv_atomic(test_csv, complete_test)

    artifacts = {
        "train_csv": _export_artifact(project.id, project_root, train_csv, "train-csv"),
        "test_csv": _export_artifact(project.id, project_root, test_csv, "test-csv"),
    }
    partial = EvaluationRecord(
        project_id=project.id,
        source_sha256=project.source_sha256,
        created_at=datetime.now(UTC),
        mode=mode,
        task_type=project.task_type,
        random_seed=pipeline_run.config.random_seed,
        same_split=True,
        train_rows=complete_train.height,
        test_rows=complete_test.height,
        full_rows=0,
        baseline=baseline_scores,
        complete=complete_scores,
        artifacts=artifacts,
    )
    _write_text_atomic(report_html, _render_report(project, analysis, pipeline_run, partial))
    partial.artifacts["report_html"] = _export_artifact(
        project.id, project_root, report_html, "report"
    )
    _write_json_atomic(result_json, partial.model_dump(mode="json"))
    return partial


def _build_cleaning_exports(
    project: ProjectRecord,
    analysis: ProjectAnalysis,
    pipeline_run: PipelineRunRecord,
    project_root: Path,
    mode: EvaluationMode,
) -> EvaluationRecord:
    if mode != EvaluationMode.OFF:
        raise ValueError("纯数据清洗不运行模型评估，请选择关闭档")
    processed = _read_required_parquet(project_root / "working" / "processed.parquet")
    if processed.height != pipeline_run.full_rows:
        raise ValueError("清洗工作文件与运行记录行数不一致")
    exports = project_root / "exports"
    reports = project_root / "reports"
    results = project_root / "results"
    for directory in (exports, reports, results):
        directory.mkdir(parents=True, exist_ok=True)
    processed_csv = exports / "processed.csv"
    report_html = reports / "report.html"
    result_json = results / "evaluation.json"
    _write_csv_atomic(processed_csv, processed)
    record = EvaluationRecord(
        project_id=project.id,
        source_sha256=project.source_sha256,
        created_at=datetime.now(UTC),
        mode=EvaluationMode.OFF,
        task_type=project.task_type,
        random_seed=pipeline_run.config.random_seed,
        same_split=False,
        train_rows=0,
        test_rows=0,
        full_rows=processed.height,
        artifacts={
            "processed_csv": _export_artifact(
                project.id, project_root, processed_csv, "processed-csv"
            )
        },
    )
    _write_text_atomic(report_html, _render_report(project, analysis, pipeline_run, record))
    record.artifacts["report_html"] = _export_artifact(
        project.id, project_root, report_html, "report"
    )
    _write_json_atomic(result_json, record.model_dump(mode="json"))
    return record


def _minimal_baseline(
    train: pl.DataFrame,
    test: pl.DataFrame,
    analysis: ProjectAnalysis,
    feature_names: list[str],
) -> tuple[sparse.csr_matrix, sparse.csr_matrix]:
    roles = {field.name: field.role for field in analysis.fields}
    train_parts: list[sparse.spmatrix] = []
    test_parts: list[sparse.spmatrix] = []
    for name in feature_names:
        role = roles[name]
        if role in NUMERIC_ROLES:
            train_values = _numeric_array(train.get_column(name), name)
            test_values = _numeric_array(test.get_column(name), name)
            observed = train_values[~np.isnan(train_values)]
            fill_value = float(np.median(observed)) if observed.size else 0.0
            train_filled = np.nan_to_num(train_values, nan=fill_value).reshape(-1, 1)
            test_filled = np.nan_to_num(test_values, nan=fill_value).reshape(-1, 1)
            train_parts.append(sparse.csr_matrix(train_filled))
            test_parts.append(sparse.csr_matrix(test_filled))
        else:
            train_values = _category_array(train.get_column(name))
            test_values = _category_array(test.get_column(name))
            observed = [value for value in train_values if value != "__MISSING__"]
            fill_value = Counter(observed).most_common(1)[0][0] if observed else "__MISSING__"
            train_values = np.array(
                [fill_value if value == "__MISSING__" else value for value in train_values]
            ).reshape(-1, 1)
            test_values = np.array(
                [fill_value if value == "__MISSING__" else value for value in test_values]
            ).reshape(-1, 1)
            encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=True)
            train_parts.append(encoder.fit_transform(train_values))
            test_parts.append(encoder.transform(test_values))
    if not train_parts:
        raise ValueError("没有可用于最低限度基线的特征")
    return sparse.hstack(train_parts, format="csr"), sparse.hstack(test_parts, format="csr")


def _evaluate(
    task_type: TaskType,
    train_x: sparse.spmatrix | np.ndarray,
    test_x: sparse.spmatrix | np.ndarray,
    train_y: np.ndarray,
    test_y: np.ndarray,
    random_seed: int,
    name: str,
) -> EvaluationScores:
    if task_type == TaskType.CLASSIFICATION:
        model = LogisticRegression(max_iter=1_000, random_state=random_seed)
        model.fit(train_x, train_y)
        prediction = model.predict(test_x)
        metrics = {
            "accuracy": float(accuracy_score(test_y, prediction)),
            "balanced_accuracy": float(balanced_accuracy_score(test_y, prediction)),
            "f1_weighted": float(f1_score(test_y, prediction, average="weighted", zero_division=0)),
        }
    elif task_type == TaskType.REGRESSION:
        numeric_train_y = _target_numeric(train_y)
        numeric_test_y = _target_numeric(test_y)
        model = Ridge(alpha=1.0)
        model.fit(train_x, numeric_train_y)
        prediction = model.predict(test_x)
        metrics = {
            "mae": float(mean_absolute_error(numeric_test_y, prediction)),
            "rmse": float(math.sqrt(mean_squared_error(numeric_test_y, prediction))),
            "r2": float(r2_score(numeric_test_y, prediction)),
        }
    else:
        raise ValueError("快速评估仅支持分类和回归")
    return EvaluationScores(name=name, metrics=metrics)


def _numeric_array(series: pl.Series, name: str) -> np.ndarray:
    casted = series.cast(pl.Float64, strict=False)
    if casted.null_count() - series.null_count() > 0:
        raise ValueError(f"基线数值字段 {name} 包含无法解析的值")
    return np.array([np.nan if value is None else float(value) for value in casted.to_list()])


def _category_array(series: pl.Series) -> np.ndarray:
    return np.array(
        ["__MISSING__" if value is None else str(value).strip() for value in series.to_list()]
    )


def _target_numeric(values: np.ndarray) -> np.ndarray:
    try:
        return values.astype(float)
    except (TypeError, ValueError) as exc:
        raise ValueError("回归目标包含无法解析的数值") from exc


def _read_required_parquet(path: Path) -> pl.DataFrame:
    if not path.is_file():
        raise ValueError(f"缺少评估所需工作文件：{path.name}")
    return pl.read_parquet(path)


def _render_report(
    project: ProjectRecord,
    analysis: ProjectAnalysis,
    pipeline: PipelineRunRecord,
    evaluation: EvaluationRecord,
) -> str:
    metric_labels = {
        "accuracy": "准确率",
        "balanced_accuracy": "平衡准确率",
        "f1_weighted": "加权 F1",
        "mae": "MAE",
        "rmse": "RMSE",
        "r2": "R²",
    }

    def score_cards(scores: EvaluationScores | None) -> str:
        if scores is None:
            return '<p class="muted">评估已关闭，本次只生成处理数据与记录。</p>'
        cards = "".join(
            f'<div class="metric"><span>{html.escape(metric_labels.get(key, key))}</span><strong>{value:.4f}</strong></div>'
            for key, value in scores.metrics.items()
        )
        return f'<section class="scheme"><h3>{html.escape(scores.name)}</h3><div class="metrics">{cards}</div></section>'

    dimensions = "".join(
        f'<li><span>{html.escape(item.label)}</span><strong>{item.score}</strong></li>'
        for item in analysis.quality.dimensions
    )
    applied = "".join(
        f"<li><code>{html.escape(item.rule_id)}</code> {html.escape(item.title)}</li>"
        for item in analysis.recommendations
        if item.id in pipeline.applied_recommendation_ids
    ) or "<li>没有启用规则建议</li>"
    row_summary = (
        f"完整数据 {evaluation.full_rows} 行"
        if project.task_type == TaskType.CLEANING
        else f"训练 / 测试 {evaluation.train_rows} / {evaluation.test_rows}"
    )
    comparison_note = (
        "纯数据清洗不运行模型评估，本报告记录全量处理方案与导出结果。"
        if project.task_type == TaskType.CLEANING
        else "两个方案使用完全相同的训练集、测试集、目标列和随机种子。结果仅作为预处理效果的快速参考。"
    )
    score_sections = (
        score_cards(evaluation.baseline) + score_cards(evaluation.complete)
        if evaluation.baseline or evaluation.complete
        else '<p class="muted">本次未运行模型评估。</p>'
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>{html.escape(project.name)} · Better Data 报告</title><style>
:root{{--ink:#172554;--muted:#475569;--primary:#1e40af;--line:#cbd5e1;--soft:#eff6ff;--ok:#047857}}*{{box-sizing:border-box}}body{{margin:0;background:#f8fafc;color:var(--ink);font:16px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif}}main{{width:min(960px,calc(100% - 32px));margin:32px auto}}header,.block{{margin-bottom:16px;border:1px solid #e2e8f0;border-radius:12px;background:white;padding:24px}}h1{{margin:4px 0;font-size:28px}}h2{{margin:0 0 16px;font-size:20px}}h3{{margin:0 0 12px;font-size:16px}}p{{margin:8px 0}}.eyebrow,small,.muted{{color:var(--muted)}}.eyebrow{{font-size:13px;font-weight:700}}.summary,.metrics,.quality{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}}.summary div,.metric,.quality li{{border-radius:8px;background:var(--soft);padding:12px}}.summary span,.metric span,.quality span{{display:block;color:var(--muted);font-size:12px}}.summary strong,.metric strong,.quality strong{{font-family:Consolas,monospace;font-size:18px}}.schemes{{display:grid;gap:12px}}.scheme{{border:1px solid var(--line);border-radius:8px;padding:16px}}.quality{{margin:0;padding:0;list-style:none}}.quality li{{display:flex;justify-content:space-between}}code{{color:var(--primary)}}footer{{color:var(--muted);font-size:12px;text-align:center}}@media print{{body{{background:white}}main{{width:100%;margin:0}}header,.block{{break-inside:avoid}}}}
</style></head><body><main><header><p class="eyebrow">BETTER DATA · 本地离线报告</p><h1>{html.escape(project.name)}</h1><p>{html.escape(project.source_filename)}</p><div class="summary"><div><span>任务</span><strong>{html.escape(project.task_type.value)}</strong></div><div><span>数据范围</span><strong>{row_summary}</strong></div><div><span>随机种子</span><strong>{evaluation.random_seed}</strong></div><div><span>输入 SHA-256</span><small>{html.escape(project.source_sha256)}</small></div></div></header>
<section class="block"><h2>{'处理结果' if project.task_type == TaskType.CLEANING else '快速评估'}</h2><p class="muted">{comparison_note}</p><div class="schemes">{score_sections}</div></section>
<section class="block"><h2>六维质量评分</h2><ul class="quality">{dimensions}</ul><p class="muted">综合分 {analysis.quality.total_score}/100；{'基于抽样画像' if analysis.quality.sampled else '基于当前画像范围'}。</p></section>
<section class="block"><h2>已应用建议</h2><ul>{applied}</ul></section>
<section class="block"><h2>可复现信息</h2><p>流水线配置版本 {pipeline.config.schema_version}，状态版本 {pipeline.schema_version}，类别新值映射到 unknown 特征。训练参数只从训练集学习。</p></section>
<footer>此文件不加载脚本、字体、图片或任何外部网络资源。生成时间：{evaluation.created_at.isoformat()}</footer></main></body></html>"""


def _export_artifact(
    project_id: str,
    project_root: Path,
    path: Path,
    artifact_name: str,
) -> ExportArtifact:
    return ExportArtifact(
        path=str(path.relative_to(project_root)).replace("\\", "/"),
        download_url=f"/api/projects/{project_id}/artifacts/{artifact_name}",
        size=path.stat().st_size,
        sha256=_sha256(path),
    )


def _write_csv_atomic(path: Path, frame: pl.DataFrame) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    try:
        frame.write_csv(temporary, include_bom=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_text_atomic(path: Path, content: str) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_json_atomic(path: Path, payload: object) -> None:
    _write_text_atomic(path, json.dumps(payload, ensure_ascii=False, indent=2))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
