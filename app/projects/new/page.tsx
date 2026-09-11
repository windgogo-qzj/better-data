"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProjectJourney } from "../project-journey";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

const taskTypes = [
  { label: "分类", code: "classification", description: "预测离散类别，例如是否流失" },
  { label: "回归", code: "regression", description: "预测连续数值，例如价格或销量" },
  { label: "纯数据清洗", code: "cleaning", description: "不建模，只修复质量问题并导出" },
  { label: "聚类预处理", code: "clustering_prep", description: "当前仅支持画像和建议审阅", previewOnly: true },
] as const;

type TaskCode = (typeof taskTypes)[number]["code"];
type CreationState = "idle" | "creating" | "success";

type CreatedProject = {
  id: string;
  name: string;
  status: string;
  error?: string | null;
  profile?: { column_count: number; sampled_rows: number } | null;
};

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function NewProjectPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [taskType, setTaskType] = useState<TaskCode>("classification");
  const [dragging, setDragging] = useState(false);
  const [creationState, setCreationState] = useState<CreationState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<CreatedProject | null>(null);

  const selectedTask = taskTypes.find((item) => item.code === taskType) ?? taskTypes[0];
  const fileExtension = selectedFile?.name.split(".").pop()?.toLowerCase() ?? "";
  const xlsxPreview = fileExtension === "xlsx";
  const previewOnly = xlsxPreview || "previewOnly" in selectedTask;

  const fileIssue = useMemo(() => {
    if (!selectedFile) return null;
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!extension || !["csv", "xlsx"].includes(extension)) return "仅支持 CSV 和 XLSX 文件，请重新选择。";
    const limit = extension === "csv" ? 1024 : 200;
    if (selectedFile.size > limit * 1024 * 1024) return `${extension.toUpperCase()} 文件超过 ${limit} MB，请拆分数据后重试。`;
    return null;
  }, [selectedFile]);

  function acceptFiles(files: FileList | null) {
    if (!files?.[0] || creationState !== "idle") return;
    setSelectedFile(files[0]);
    setSubmitError(null);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || fileIssue || creationState !== "idle") return;
    setCreationState("creating");
    setSubmitError(null);
    const form = new FormData();
    form.append("name", selectedFile.name.replace(/\.(csv|xlsx)$/i, ""));
    form.append("task_type", taskType);
    form.append("dataset", selectedFile);
    try {
      const response = await fetch(`${API_BASE}/api/projects`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "项目创建失败，请检查文件后重试。");
      const project = payload as CreatedProject;
      if (project.status === "failed" || !project.profile) {
        throw new Error(project.error ?? "数据画像生成失败，请检查文件编码、表头和数据格式。");
      }
      setCreatedProject(project);
      setCreationState("success");
      window.setTimeout(() => router.push(`/projects/${project.id}/overview`), 650);
    } catch (error) {
      setCreationState("idle");
      setSubmitError(error instanceof Error ? error.message : "无法连接本地处理服务，请启动服务后重试。");
    }
  }

  return (
    <div className="new-project-page">
      <a className="skip-link" href="#new-project-main">跳到主要内容</a>
      <header className="new-project-header">
        <div className="new-project-header-inner">
          <Link className="new-project-brand" href="/" aria-label="返回 Better Data 首页"><span><Database aria-hidden="true" /></span><strong>Better Data</strong></Link>
          <Link className="new-project-back" href="/workspace"><ArrowLeft aria-hidden="true" />返回项目库</Link>
        </div>
      </header>

      <main id="new-project-main" className="new-project-main">
        <ProjectJourney current="create" />

        <div className="new-project-heading">
          <p className="new-project-stage">01 / 07 · 创建项目</p>
          <h1>从一份数据开始</h1>
          <p>选择本机文件并说明处理目标。创建后，流程会连续进入数据概览。</p>
        </div>

        <form className="new-project-form" onSubmit={createProject} aria-busy={creationState === "creating"}>
          <div className="new-project-canvas">
          <section className="new-project-section new-project-source" aria-labelledby="file-section-title">
            <div className="new-project-card-heading"><span>数据源</span><div><h2 id="file-section-title">选择数据文件</h2><p>先检查格式和大小，原始文件始终只读保存。</p></div></div>
            <button
              className="new-project-dropzone"
              type="button"
              data-dragging={dragging}
              data-selected={Boolean(selectedFile)}
              disabled={creationState !== "idle"}
              aria-describedby={`new-file-help${fileIssue ? " new-file-error" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <span className="new-project-file-icon">{selectedFile ? <FileSpreadsheet aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}</span>
              {selectedFile ? (
                <span className="new-project-file-copy"><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)} · {fileExtension.toUpperCase()} · 点击重新选择</small></span>
              ) : (
                <span className="new-project-file-copy"><strong>{dragging ? "松开鼠标以选择文件" : "拖放文件，或点击浏览"}</strong><small>数据只在本机读取</small></span>
              )}
              <span className="new-project-browse">浏览</span>
            </button>
            <input ref={inputRef} className="sr-only" type="file" tabIndex={-1} aria-hidden="true" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => acceptFiles(event.target.files)} />
            <p id="new-file-help" className="field-helper">CSV 完整支持，最大 1 GB；XLSX 当前仅支持画像预览，最大 200 MB。</p>
            {fileIssue && <p id="new-file-error" className="field-error" role="alert">{fileIssue}</p>}
            {xlsxPreview && !fileIssue && <div className="new-project-boundary status-info"><Info aria-hidden="true" /><div><strong>XLSX 仅支持预览分析</strong><p>可以查看结构、字段和质量建议，但当前版本不能执行预处理。需要完整处理时，请先另存为 CSV。</p></div></div>}
          </section>

          <section className="new-project-section new-project-goal" aria-labelledby="task-section-title">
            <div className="new-project-card-heading"><span>处理目标</span><div><h2 id="task-section-title">这份数据要用于什么</h2><p>目标决定字段规则、数据划分和评估方法。</p></div></div>
            <fieldset className="new-project-task-fieldset">
              <legend className="sr-only">任务类型</legend>
              <div className="task-grid">
                {taskTypes.map((type) => {
                  const active = taskType === type.code;
                  return (
                    <label key={type.code} className={`task-option ${active ? "task-option-active" : ""}`}>
                      <input className="sr-only" type="radio" name="task-type" value={type.code} checked={active} disabled={creationState !== "idle"} onChange={() => setTaskType(type.code)} />
                      <span className="task-option-title">{active && <Check aria-hidden="true" />}{type.label}</span>
                      <span>{type.description}</span>
                      {"previewOnly" in type && <small>Beta 预览</small>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>
          </div>

          {submitError && <div className="new-project-submit-message status-error" role="alert"><Info aria-hidden="true" /><div><strong>项目创建失败</strong><p>{submitError}</p></div></div>}
          {creationState === "creating" && (
            <div className="new-project-submit-message status-info" role="status" aria-live="polite">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <div><strong>正在复制文件并生成数据画像</strong><p>请保持此页面打开。文件越大，需要的时间越长。</p></div>
            </div>
          )}
          {creationState === "success" && createdProject && (
            <div className="new-project-submit-message status-success" role="status" aria-live="polite">
              <CheckCircle2 aria-hidden="true" />
              <div><strong>项目“{createdProject.name}”已创建</strong><p>结构检查完成，正在进入数据概览。</p></div>
            </div>
          )}

          <div className="new-project-actions">
            <div className="new-project-privacy"><ShieldCheck aria-hidden="true" /><span>仅在本机处理 · 原始文件只读</span></div>
            <div><Link className="new-project-cancel" href="/workspace" aria-disabled={creationState !== "idle"}>取消</Link><Button type="submit" disabled={!selectedFile || Boolean(fileIssue) || creationState !== "idle"} aria-busy={creationState === "creating"}>{creationState === "creating" && <LoaderCircle className="animate-spin" aria-hidden="true" />}{previewOnly ? "创建预览项目" : "创建并查看概览"}</Button></div>
          </div>
        </form>
      </main>
    </div>
  );
}
