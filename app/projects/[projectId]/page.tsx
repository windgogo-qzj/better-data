"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Save,
  ShieldCheck,
  Play,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

const roleOptions = [
  ["continuous_numeric", "连续数值"],
  ["discrete_numeric", "离散数值"],
  ["nominal_category", "名义类别"],
  ["ordinal_category", "有序类别"],
  ["boolean", "布尔"],
  ["datetime", "日期时间"],
  ["id", "ID"],
  ["text", "文本（默认不处理）"],
  ["target", "目标列"],
  ["group", "分组"],
  ["sensitive", "敏感字段"],
  ["ignore", "忽略"],
] as const;

const taskLabels: Record<string, string> = {
  classification: "分类",
  regression: "回归",
  clustering_prep: "聚类预处理",
  cleaning: "纯数据清洗",
};

const riskLabels = { low: "低风险", medium: "中风险", high: "高风险" } as const;

type Project = {
  id: string;
  name: string;
  task_type: string;
  status: string;
  source_filename: string;
  profile: { sampled_rows: number; is_sampled: boolean; column_count: number } | null;
};

type FieldRole = { name: string; role: string; inferred_type: string };
type Deduction = { rule_id: string; column: string | null; points: number; reason: string; evidence: string };
type Dimension = { key: string; label: string; score: number; deductions: Deduction[] };
type Recommendation = {
  id: string;
  rule_id: string;
  title: string;
  column: string | null;
  problem: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  confidence: number;
  action: string;
  parameters: Record<string, string | number | boolean>;
  expected_impact: string;
  side_effects: string[];
  alternatives: string[];
  enabled: boolean;
  conflicts_with: string[];
};
type Analysis = {
  schema_version: number;
  project_id: string;
  fields: FieldRole[];
  quality: { total_score: number; sampled: boolean; dimensions: Dimension[] };
  recommendations: Recommendation[];
  fields_confirmed: boolean;
};

type PipelineRun = {
  created_at: string;
  train_rows: number;
  test_rows: number;
  full_rows: number;
  target_missing_rows: number;
  stratified: boolean;
  output_feature_columns: string[];
  applied_recommendation_ids: string[];
  test_unknown_categories: Record<string, number>;
  artifacts: Record<string, { path: string; row_count: number; column_count: number; sha256: string }>;
};
type Evaluation = {
  created_at: string;
  mode: "off" | "quick";
  same_split: boolean;
  random_seed: number;
  train_rows: number;
  test_rows: number;
  full_rows: number;
  baseline: { name: string; metrics: Record<string, number> } | null;
  complete: { name: string; metrics: Record<string, number> } | null;
  artifacts: Record<string, { path: string; download_url: string; size: number; sha256: string }>;
};

async function readJson(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail ?? "本地服务返回异常");
  return payload;
}

export default function ProjectAnalysisPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingFields, setSavingFields] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineRun, setPipelineRun] = useState<PipelineRun | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluationMode, setEvaluationMode] = useState<"off" | "quick">("quick");
  const [evaluating, setEvaluating] = useState(false);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState({
    test_size: 0.2,
    random_seed: 42,
    stratify_classification: true,
    drop_duplicates: true,
    drop_constant_features: true,
    numeric_imputation: "median",
    categorical_imputation: "most_frequent",
    scaling: "standard",
    max_categories: 50,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_BASE}/api/projects/${projectId}`, { signal: controller.signal }).then(readJson),
      fetch(`${API_BASE}/api/projects/${projectId}/analysis`, { signal: controller.signal }).then(readJson),
      fetch(`${API_BASE}/api/projects/${projectId}/pipeline-runs/latest`, { signal: controller.signal })
        .then((response) => response.status === 404 ? null : readJson(response)),
      fetch(`${API_BASE}/api/projects/${projectId}/evaluation`, { signal: controller.signal })
        .then((response) => response.status === 404 ? null : readJson(response)),
    ])
      .then(([projectPayload, analysisPayload, runPayload, evaluationPayload]: [Project, Analysis, PipelineRun | null, Evaluation | null]) => {
        setProject(projectPayload);
        if (projectPayload.task_type === "cleaning") setEvaluationMode("off");
        applyAnalysis(analysisPayload);
        setPipelineRun(runPayload);
        setEvaluation(evaluationPayload);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "无法读取项目分析");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId]);

  const targetCount = useMemo(
    () => Object.values(roles).filter((role) => role === "target").length,
    [roles],
  );
  const supervised = project?.task_type === "classification" || project?.task_type === "regression";
  const cleaning = project?.task_type === "cleaning";
  const clusteringPreview = project?.task_type === "clustering_prep";
  const fieldValidation = supervised && targetCount !== 1
    ? `当前有 ${targetCount} 个目标列，分类和回归必须且只能选择 1 个。`
    : !supervised && targetCount > 0
      ? "纯清洗和聚类预处理不使用目标列。"
      : null;

  function applyAnalysis(next: Analysis) {
    setAnalysis(next);
    setRoles(Object.fromEntries(next.fields.map((field) => [field.name, field.role])));
    setEnabledIds(new Set(next.recommendations.filter((item) => item.enabled).map((item) => item.id)));
    setFieldsDirty(false);
    setRulesDirty(false);
  }

  async function saveFields() {
    if (!analysis || fieldValidation) return;
    setSavingFields(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: analysis.fields.map((field) => ({ name: field.name, role: roles[field.name] })),
        }),
      });
      const payload = await readJson(response) as Analysis;
      applyAnalysis(payload);
      setPipelineRun(null);
      setEvaluation(null);
      setNotice("字段角色已确认，质量评分和建议已按新配置重新计算。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "字段配置保存失败");
    } finally {
      setSavingFields(false);
    }
  }

  async function saveRecommendations() {
    if (!analysis) return;
    setSavingRules(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/recommendations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_ids: [...enabledIds] }),
      });
      const payload = await readJson(response) as Analysis;
      applyAnalysis(payload);
      setPipelineRun(null);
      setEvaluation(null);
      setNotice("建议选择已保存。冲突检查通过，但尚未执行任何数据变换。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "建议选择保存失败");
    } finally {
      setSavingRules(false);
    }
  }

  async function runPipeline() {
    if (!analysis || !analysis.fields_confirmed || fieldsDirty || rulesDirty) return;
    setRunningPipeline(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/pipeline-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: pipelineConfig }),
      });
      const payload = await readJson(response) as PipelineRun;
      setPipelineRun(payload);
      setEvaluation(null);
      setProject((current) => current ? { ...current, status: "processed" } : current);
      setNotice(`预处理完成：训练集 ${payload.train_rows} 行，测试集 ${payload.test_rows} 行。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "预处理执行失败");
    } finally {
      setRunningPipeline(false);
    }
  }

  async function createEvaluation() {
    if (!pipelineRun) return;
    setEvaluating(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/evaluation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: evaluationMode }),
      });
      const payload = await readJson(response) as Evaluation;
      setEvaluation(payload);
      setNotice(evaluationMode === "quick" ? "快速评估、离线报告和 CSV 已生成。" : "评估已关闭，CSV 和离线报告已生成。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "结果生成失败");
    } finally {
      setEvaluating(false);
    }
  }

  if (loading) {
    return <main className="analysis-loading" aria-busy="true"><LoaderCircle className="animate-spin" aria-hidden="true" /><p>正在读取本地项目分析…</p></main>;
  }

  if (!project || !analysis) {
    return (
      <main className="analysis-loading">
        <CircleAlert aria-hidden="true" />
        <h1>无法打开项目</h1>
        <p>{error ?? "项目不存在或尚未完成数据画像。"}</p>
        <Button asChild variant="outline"><Link href="/">返回工作台</Link></Button>
      </main>
    );
  }

  return (
    <div className="analysis-shell">
      <a className="skip-link" href="#analysis-main">跳到主要内容</a>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{notice}</p>
      <header className="analysis-topbar">
        <Link className="analysis-brand" href="/" aria-label="返回 Better Data 工作台">
          <span className="brand-mark"><Database aria-hidden="true" /></span>
          <span><strong>Better Data</strong><small>本地数据工作台</small></span>
        </Link>
        <Badge variant="outline" className="status-success"><ShieldCheck aria-hidden="true" />仅本机处理</Badge>
      </header>

      <main id="analysis-main" className="analysis-main">
        <Link className="back-link" href="/"><ArrowLeft aria-hidden="true" />返回项目库</Link>
        <section className="analysis-heading" aria-labelledby="project-title">
          <div>
            <p className="panel-kicker">{taskLabels[project.task_type] ?? project.task_type} · 字段与质量确认</p>
            <h1 id="project-title">{project.name}</h1>
            <p>{project.source_filename} · {project.profile?.column_count ?? 0} 列 · 分析 {project.profile?.sampled_rows ?? 0} 行</p>
          </div>
          <Badge className={analysis.fields_confirmed ? "status-success" : "status-warning"}>
            {analysis.fields_confirmed ? <Check aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            {analysis.fields_confirmed ? "字段已确认" : "等待字段确认"}
          </Badge>
        </section>

        <ol className="analysis-steps" aria-label="项目进度">
          <li data-state="complete"><Check aria-hidden="true" /><span><strong>上传与画像</strong><small>已完成</small></span></li>
          <li data-state="current"><span>2</span><span><strong>字段确认</strong><small>当前步骤</small></span></li>
          <li><span>3</span><span><strong>处理方案</strong><small>审阅建议</small></span></li>
          <li><span>4</span><span><strong>执行与导出</strong><small>尚未开始</small></span></li>
        </ol>

        {error && <div className="analysis-alert" role="alert"><CircleAlert aria-hidden="true" /><div><strong>无法保存</strong><p>{error}</p></div></div>}
        {analysis.quality.sampled && (
          <div className="sample-notice"><TriangleAlert aria-hidden="true" /><p>当前评分和证据基于抽样画像，只用于方案确认；执行前仍会进行全量安全检查。</p></div>
        )}

        <section className="analysis-section" aria-labelledby="quality-title">
          <div className="analysis-section-header">
            <div><p className="panel-kicker">六维诊断</p><h2 id="quality-title">数据质量评分</h2><p>总分用于快速比较，判断依据以各维扣分证据为准。</p></div>
            <div className="quality-total" aria-label={`综合质量分 ${analysis.quality.total_score} 分`}><strong>{analysis.quality.total_score}</strong><span>/ 100</span></div>
          </div>
          <div className="quality-grid">
            {analysis.quality.dimensions.map((dimension) => (
              <article className="quality-card" key={dimension.key}>
                <div><h3>{dimension.label}</h3><strong>{dimension.score}</strong></div>
                <div className="quality-track" role="progressbar" aria-label={dimension.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={dimension.score}>
                  <span style={{ width: `${dimension.score}%` }} />
                </div>
                {dimension.deductions.length ? (
                  <details><summary>{dimension.deductions.length} 项扣分证据</summary><ul>{dimension.deductions.map((item, index) => <li key={`${item.rule_id}-${item.column}-${index}`}><code>{item.rule_id}</code><strong>{item.reason}</strong><span>{item.evidence}</span></li>)}</ul></details>
                ) : <p className="quality-pass"><Check aria-hidden="true" />抽样中未发现扣分项</p>}
              </article>
            ))}
          </div>
        </section>

        <section className="analysis-section" aria-labelledby="fields-title">
          <div className="analysis-section-header action-header">
            <div><p className="panel-kicker">人工确认点</p><h2 id="fields-title">字段角色</h2><p>系统提供初始推断；请明确目标列、ID、敏感和忽略字段。</p></div>
            <Button onClick={saveFields} disabled={Boolean(fieldValidation) || savingFields} aria-busy={savingFields}>
              {savingFields ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {savingFields ? "正在保存" : "保存字段角色"}
            </Button>
          </div>
          {fieldValidation && <p className="field-validation" role="status"><TriangleAlert aria-hidden="true" />{fieldValidation}</p>}
          <div className="field-table-wrap">
            <table className="field-table">
              <caption className="sr-only">字段名称、推断类型与可编辑角色</caption>
              <thead><tr><th scope="col">字段</th><th scope="col">推断类型</th><th scope="col">字段角色</th></tr></thead>
              <tbody>
                {analysis.fields.map((field) => (
                  <tr key={field.name}>
                    <th scope="row"><FileSpreadsheet aria-hidden="true" />{field.name}</th>
                    <td><code>{field.inferred_type}</code></td>
                    <td>
                      <label className="sr-only" htmlFor={`role-${field.name}`}>设置 {field.name} 的角色</label>
                      <select id={`role-${field.name}`} value={roles[field.name]} onChange={(event) => { setRoles((current) => ({ ...current, [field.name]: event.target.value })); setFieldsDirty(true); }}>
                        {roleOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="analysis-section" aria-labelledby="rules-title">
          <div className="analysis-section-header action-header">
            <div><p className="panel-kicker">可追溯规则</p><h2 id="rules-title">处理建议</h2><p>低风险建议可能默认开启；高风险和冲突项必须由你明确确认。</p></div>
            <Button onClick={saveRecommendations} disabled={savingRules} aria-busy={savingRules}>
              {savingRules ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <SlidersHorizontal aria-hidden="true" />}
              {savingRules ? "正在检查" : "保存建议选择"}
            </Button>
          </div>
          {analysis.recommendations.length ? (
            <div className="recommendation-list">
              {analysis.recommendations.map((item) => {
                const checked = enabledIds.has(item.id);
                return (
                  <article className="recommendation-card" key={item.id} data-enabled={checked}>
                    <div className="recommendation-heading">
                      <label className="recommendation-toggle">
                        <input type="checkbox" checked={checked} onChange={(event) => { setEnabledIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; }); setRulesDirty(true); }} />
                        <span aria-hidden="true" />
                        <span className="sr-only">{checked ? "关闭" : "启用"}建议 {item.title}</span>
                      </label>
                      <div><div className="recommendation-badges"><code>{item.rule_id}</code><Badge className={`risk-${item.risk}`}>{riskLabels[item.risk]}</Badge><span>置信度 {Math.round(item.confidence * 100)}%</span></div><h3>{item.title}</h3></div>
                    </div>
                    <p>{item.problem}</p>
                    <dl className="recommendation-evidence"><div><dt>证据</dt><dd>{item.evidence}</dd></div><div><dt>预计影响</dt><dd>{item.expected_impact}</dd></div>{item.side_effects.length > 0 && <div><dt>潜在副作用</dt><dd>{item.side_effects.join("；")}</dd></div>}{item.alternatives.length > 0 && <div><dt>替代方案</dt><dd>{item.alternatives.join("；")}</dd></div>}</dl>
                    {item.conflicts_with.length > 0 && <p className="conflict-note"><TriangleAlert aria-hidden="true" />与 {item.conflicts_with.length} 条建议互斥，保存时由服务端统一检查。</p>}
                  </article>
                );
              })}
            </div>
          ) : <div className="analysis-empty"><Sparkles aria-hidden="true" /><p>当前抽样和字段配置没有触发处理建议。</p></div>}
        </section>

        <section className="analysis-section" aria-labelledby="pipeline-title">
          <div className="analysis-section-header action-header">
            <div><p className="panel-kicker">{cleaning ? "完整数据处理" : "训练集拟合边界"}</p><h2 id="pipeline-title">基础预处理流水线</h2><p>{cleaning ? "不划分数据，使用完整数据完成基础清洗、类别处理与缩放。" : clusteringPreview ? "聚类预处理执行与诊断将在 Beta 阶段提供。" : "先划分，再仅用训练集学习填充值、类别词表、缩放参数和常量特征。"}</p></div>
            <Button onClick={runPipeline} disabled={clusteringPreview || !analysis.fields_confirmed || Boolean(fieldValidation) || fieldsDirty || rulesDirty || runningPipeline} aria-busy={runningPipeline}>
              {runningPipeline ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              {runningPipeline ? "正在处理" : pipelineRun ? "重新运行" : "运行预处理"}
            </Button>
          </div>
          <div className="leakage-note"><ShieldCheck aria-hidden="true" /><div><strong>{cleaning ? "原始数据保护" : "防泄漏保证"}</strong><p>{cleaning ? "不修改 source 原始文件；完整数据的清洗状态和结果写入独立工作文件。" : "测试集不参与统计参数学习；新类别进入独立 unknown 特征；目标缺失行单独保存。"}</p></div></div>
          {clusteringPreview && <p className="pipeline-blocker" role="status"><TriangleAlert aria-hidden="true" />聚类模式当前可完成画像、字段确认和建议审阅，执行与评估属于 Beta。</p>}
          {(fieldsDirty || rulesDirty || !analysis.fields_confirmed) && <p className="pipeline-blocker" role="status"><TriangleAlert aria-hidden="true" />{!analysis.fields_confirmed ? "请先保存并确认字段角色。" : "字段或建议有未保存更改，请保存后再运行。"}</p>}
          <div className="pipeline-config-grid">
            {!cleaning && <label><span>测试集比例</span><select value={pipelineConfig.test_size} onChange={(event) => setPipelineConfig((current) => ({ ...current, test_size: Number(event.target.value) }))}><option value={0.2}>20%（推荐）</option><option value={0.25}>25%</option><option value={0.3}>30%</option></select></label>}
            {!cleaning && <label><span>随机种子</span><input type="number" min={0} max={2147483647} value={pipelineConfig.random_seed} onChange={(event) => setPipelineConfig((current) => ({ ...current, random_seed: Number(event.target.value) }))} /></label>}
            <label><span>数值缺失</span><select value={pipelineConfig.numeric_imputation} onChange={(event) => setPipelineConfig((current) => ({ ...current, numeric_imputation: event.target.value }))}><option value="median">中位数（推荐）</option><option value="mean">均值</option></select></label>
            <label><span>类别缺失</span><select value={pipelineConfig.categorical_imputation} onChange={(event) => setPipelineConfig((current) => ({ ...current, categorical_imputation: event.target.value }))}><option value="most_frequent">{cleaning ? "完整数据众数" : "训练集众数"}</option><option value="missing_category">独立缺失类别</option></select></label>
            <label><span>数值缩放</span><select value={pipelineConfig.scaling} onChange={(event) => setPipelineConfig((current) => ({ ...current, scaling: event.target.value }))}><option value="standard">标准化</option><option value="minmax">Min-Max</option><option value="none">不缩放</option></select></label>
            <label><span>类别维度上限</span><input type="number" min={2} max={500} value={pipelineConfig.max_categories} onChange={(event) => setPipelineConfig((current) => ({ ...current, max_categories: Number(event.target.value) }))} /></label>
          </div>
          <fieldset className="pipeline-checks"><legend>结构处理</legend><label><input type="checkbox" checked={pipelineConfig.drop_duplicates} onChange={(event) => setPipelineConfig((current) => ({ ...current, drop_duplicates: event.target.checked }))} />移除完全重复行</label><label><input type="checkbox" checked={pipelineConfig.drop_constant_features} onChange={(event) => setPipelineConfig((current) => ({ ...current, drop_constant_features: event.target.checked }))} />按{cleaning ? "完整数据" : "训练集"}移除常量特征</label>{supervised && project.task_type === "classification" && <label><input type="checkbox" checked={pipelineConfig.stratify_classification} onChange={(event) => setPipelineConfig((current) => ({ ...current, stratify_classification: event.target.checked }))} />分类任务使用分层划分</label>}</fieldset>
          {pipelineRun && (
            <div className="pipeline-result" aria-live="polite">
              <div><Check aria-hidden="true" /><div><strong>最近一次预处理已完成</strong><p>{cleaning ? `完整数据 ${pipelineRun.full_rows} 行` : `训练集 ${pipelineRun.train_rows} 行 · 测试集 ${pipelineRun.test_rows} 行`} · 输出 {pipelineRun.output_feature_columns.length} 个特征</p></div></div>
              <dl><div><dt>处理范围</dt><dd>{cleaning ? "完整数据，不划分" : pipelineRun.stratified ? "固定种子分层" : "固定种子随机"}</dd></div><div><dt>{cleaning ? "重复处理" : "缺失目标"}</dt><dd>{cleaning ? (pipelineConfig.drop_duplicates ? "已启用" : "未启用") : `${pipelineRun.target_missing_rows} 行`}</dd></div><div><dt>应用建议</dt><dd>{pipelineRun.applied_recommendation_ids.length} 条</dd></div><div><dt>内部文件</dt><dd>{cleaning ? "processed.parquet" : "train.parquet / test.parquet"}</dd></div></dl>
              <p>评估、CSV 和 HTML 报告将在结果阶段生成；当前文件保存在项目 working 目录。</p>
            </div>
          )}
        </section>

        <section className="analysis-section" aria-labelledby="results-title">
          <div className="analysis-section-header action-header">
            <div><p className="panel-kicker">{cleaning ? "完整结果" : "同一划分对比"}</p><h2 id="results-title">{cleaning ? "清洗结果与导出" : "快速评估与导出"}</h2><p>{cleaning ? "纯清洗不运行模型评估，生成一份完整 CSV 和离线报告。" : "分类使用逻辑回归，回归使用 Ridge；也可以关闭评估，只生成数据和报告。"}</p></div>
            <Button onClick={createEvaluation} disabled={!pipelineRun || evaluating} aria-busy={evaluating}>
              {evaluating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <BarChart3 aria-hidden="true" />}
              {evaluating ? "正在生成" : evaluation ? "重新生成" : "生成结果"}
            </Button>
          </div>
          {!pipelineRun && <p className="pipeline-blocker" role="status"><TriangleAlert aria-hidden="true" />请先完成基础预处理，再生成评估与导出结果。</p>}
          <fieldset className="evaluation-mode"><legend>{cleaning ? "输出方式" : "评估档位"}</legend>{!cleaning && <label data-active={evaluationMode === "quick"}><input type="radio" name="evaluation-mode" value="quick" checked={evaluationMode === "quick"} onChange={() => setEvaluationMode("quick")} /><span><strong>快速</strong><small>对比最低限度兼容方案与完整方案</small></span></label>}<label data-active={evaluationMode === "off"}><input type="radio" name="evaluation-mode" value="off" checked={evaluationMode === "off"} onChange={() => setEvaluationMode("off")} /><span><strong>{cleaning ? "生成完整结果" : "关闭"}</strong><small>{cleaning ? "导出一份处理后 CSV 和离线报告" : "只生成 CSV、报告和运行记录"}</small></span></label></fieldset>
          {evaluation && (
            <div className="evaluation-result">
              <div className="fairness-note"><ShieldCheck aria-hidden="true" /><p>{cleaning ? `已处理完整数据 ${evaluation.full_rows} 行，未创建训练测试划分。` : `公平比较已确认：两个方案使用相同的 ${evaluation.train_rows}/${evaluation.test_rows} 训练测试划分和随机种子 ${evaluation.random_seed}。`}</p></div>
              {evaluation.mode === "quick" && evaluation.baseline && evaluation.complete && (
                <div className="comparison-grid">
                  {[evaluation.baseline, evaluation.complete].map((scheme) => <article key={scheme.name}><h3>{scheme.name}</h3><dl>{Object.entries(scheme.metrics).map(([key, value]) => <div key={key}><dt>{({ accuracy: "准确率", balanced_accuracy: "平衡准确率", f1_weighted: "加权 F1", mae: "MAE", rmse: "RMSE", r2: "R²" } as Record<string, string>)[key] ?? key}</dt><dd>{value.toFixed(4)}</dd></div>)}</dl></article>)}
                </div>
              )}
              <div className="download-grid">
                {Object.entries(evaluation.artifacts).map(([key, artifact]) => <a key={key} href={`${API_BASE}${artifact.download_url}`} download><Download aria-hidden="true" /><span><strong>{key === "train_csv" ? "训练集 CSV" : key === "test_csv" ? "测试集 CSV" : key === "processed_csv" ? "处理后完整 CSV" : "离线 HTML 报告"}</strong><small>{(artifact.size / 1024).toFixed(1)} KB · SHA-256 已记录</small></span></a>)}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
