"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  Save,
  ShieldCheck,
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_BASE}/api/projects/${projectId}`, { signal: controller.signal }).then(readJson),
      fetch(`${API_BASE}/api/projects/${projectId}/analysis`, { signal: controller.signal }).then(readJson),
    ])
      .then(([projectPayload, analysisPayload]: [Project, Analysis]) => {
        setProject(projectPayload);
        applyAnalysis(analysisPayload);
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
  const fieldValidation = supervised && targetCount !== 1
    ? `当前有 ${targetCount} 个目标列，分类和回归必须且只能选择 1 个。`
    : !supervised && targetCount > 0
      ? "纯清洗和聚类预处理不使用目标列。"
      : null;

  function applyAnalysis(next: Analysis) {
    setAnalysis(next);
    setRoles(Object.fromEntries(next.fields.map((field) => [field.name, field.role])));
    setEnabledIds(new Set(next.recommendations.filter((item) => item.enabled).map((item) => item.id)));
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
      setNotice("建议选择已保存。冲突检查通过，但尚未执行任何数据变换。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "建议选择保存失败");
    } finally {
      setSavingRules(false);
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
                      <select id={`role-${field.name}`} value={roles[field.name]} onChange={(event) => setRoles((current) => ({ ...current, [field.name]: event.target.value }))}>
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
                        <input type="checkbox" checked={checked} onChange={(event) => setEnabledIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
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
      </main>
    </div>
  );
}
