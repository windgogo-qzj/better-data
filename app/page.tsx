"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  Activity,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  FileSpreadsheet,
  FolderOpen,
  FolderKanban,
  HardDrive,
  Home,
  Info,
  ListChecks,
  LoaderCircle,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const taskTypes = [
  { label: "分类", code: "classification", description: "为分类模型准备特征与标签" },
  { label: "回归", code: "regression", description: "为连续数值预测清洗数据" },
  { label: "聚类预处理", code: "clustering_prep", description: "完成聚类前处理与效果评估" },
  { label: "纯数据清洗", code: "cleaning", description: "只修复质量问题并导出数据" },
] as const;

type TaskLabel = (typeof taskTypes)[number]["label"];
type ServiceState = "connecting" | "ready" | "unavailable";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type ProjectSummary = {
  id: string;
  name: string;
  task_type: string;
  status: string;
  source_filename: string;
  source_size: number;
  created_at: string;
  profile?: { sampled_rows: number; column_count: number } | null;
};

type ProjectLibraryInfo = {
  path: string;
  exists: boolean;
  writable: boolean;
  project_count: number;
  needs_setup: boolean;
};

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<object>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

function formatBytes(size: number) {
  if (size === 0) return "0 B";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function projectStatus(status: string) {
  if (status === "ready") return { label: "待确认", className: "status-warning" };
  if (["processing", "running"].includes(status)) return { label: "处理中", className: "status-info" };
  if (["complete", "completed"].includes(status)) return { label: "已完成", className: "status-success" };
  if (status === "failed") return { label: "失败", className: "status-error" };
  return { label: status, className: "status-neutral" };
}

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [taskType, setTaskType] = useState<TaskLabel>("分类");
  const [dragging, setDragging] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [serviceState, setServiceState] = useState<ServiceState>("connecting");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [libraryInfo, setLibraryInfo] = useState<ProjectLibraryInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryPath, setLibraryPath] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_BASE}/api/projects`, { signal: controller.signal }),
      fetch(`${API_BASE}/api/settings/project-library`, { signal: controller.signal }),
    ])
      .then(async ([projectsResponse, libraryResponse]) => {
        if (!projectsResponse.ok || !libraryResponse.ok) throw new Error("本地服务返回异常");
        const [records, projectLibrary] = await Promise.all([
          projectsResponse.json() as Promise<ProjectSummary[]>,
          libraryResponse.json() as Promise<ProjectLibraryInfo>,
        ]);
        return { records, projectLibrary };
      })
      .then(({ records, projectLibrary }) => {
        setProjects(records);
        setLibraryInfo(projectLibrary);
        setLibraryPath(projectLibrary.path);
        setServiceState("ready");
        if (projectLibrary.needs_setup) setSettingsOpen(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setServiceState("unavailable");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "start_data_project_creation",
      title: "开始创建数据项目",
      description: "打开 Better Data 的新建项目窗口，并预先选择分类、回归、聚类预处理或纯数据清洗任务。",
      inputSchema: {
        type: "object",
        properties: {
          taskType: { type: "string", enum: taskTypes.map((item) => item.code) },
        },
        required: ["taskType"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const value = typeof input === "object" && input !== null && "taskType" in input
          ? String((input as { taskType: unknown }).taskType)
          : "";
        const selected = taskTypes.find((item) => item.code === value);
        if (!selected) throw new Error("不支持的任务类型");
        setTaskType(selected.label);
        setDialogOpen(true);
        return { status: "ready_for_file_selection", taskType: value };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const fileIssue = useMemo(() => {
    if (!selectedFile) return null;
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!extension || !["csv", "xlsx"].includes(extension)) {
      return "仅支持 CSV 和 XLSX 文件，请重新选择。";
    }
    const limit = extension === "csv" ? 1024 : 200;
    if (selectedFile.size > limit * 1024 * 1024) {
      return `${extension.toUpperCase()} 文件超过 ${limit} MB，请拆分或压缩数据后重试。`;
    }
    return null;
  }, [selectedFile]);

  const metrics = useMemo(() => {
    const activeCount = projects.filter((project) => ["processing", "running"].includes(project.status)).length;
    const storage = projects.reduce((total, project) => total + project.source_size, 0);
    return [
      { label: "本地项目", value: String(projects.length), note: projects.length ? "保存在本机" : "还没有项目", icon: FolderKanban, tone: "blue" },
      { label: "运行中任务", value: String(activeCount), note: activeCount ? "后台处理中" : "队列空闲", icon: Activity, tone: "green" },
      { label: "项目库占用", value: formatBytes(storage), note: "原始文件统计", icon: HardDrive, tone: "amber" },
    ];
  }, [projects]);

  const selectedTask = taskTypes.find((item) => item.label === taskType) ?? taskTypes[0];

  function acceptFiles(files: FileList | null) {
    if (!files?.[0]) return;
    setSelectedFile(files[0]);
    setSubmitError(null);
  }

  function openProjectDialog(event?: MouseEvent<HTMLButtonElement>) {
    dialogReturnFocusRef.current = event?.currentTarget ?? null;
    setSubmitError(null);
    setDialogOpen(true);
  }

  function openSettings(event?: MouseEvent<HTMLButtonElement>) {
    settingsReturnFocusRef.current = event?.currentTarget ?? null;
    setLibraryPath(libraryInfo?.path ?? "");
    setSettingsError(null);
    setSettingsOpen(true);
  }

  async function saveProjectLibrary() {
    const normalized = libraryPath.trim();
    if (!normalized) {
      setSettingsError("请输入项目库的绝对路径。");
      return;
    }
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/project-library`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: normalized }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "项目库保存失败，请检查路径后重试。");
      const updated = payload as ProjectLibraryInfo;
      setLibraryInfo(updated);
      setLibraryPath(updated.path);
      const projectsResponse = await fetch(`${API_BASE}/api/projects`);
      if (projectsResponse.ok) setProjects(await projectsResponse.json() as ProjectSummary[]);
      setSettingsOpen(false);
      setAnnouncement(`项目库已保存到“${updated.path}”。`);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "无法连接本地处理服务，请稍后重试。");
    } finally {
      setSavingSettings(false);
    }
  }

  async function createProject() {
    if (!selectedFile || fileIssue) return;
    setSubmitting(true);
    setSubmitError(null);
    const form = new FormData();
    form.append("name", selectedFile.name.replace(/\.(csv|xlsx)$/i, ""));
    form.append("task_type", selectedTask.code);
    form.append("dataset", selectedFile);
    try {
      const response = await fetch(`${API_BASE}/api/projects`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "项目创建失败，请检查文件后重试。");
      setProjects((current) => [payload as ProjectSummary, ...current]);
      setServiceState("ready");
      setDialogOpen(false);
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setAnnouncement(`项目“${(payload as ProjectSummary).name}”已创建，正在等待确认。`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法连接本地处理服务，请启动服务后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  const serviceCopy = serviceState === "ready"
    ? { label: "本地服务已连接", shortLabel: "本地运行", className: "service-ready" }
    : serviceState === "unavailable"
      ? { label: "本地服务未连接", shortLabel: "服务未连接", className: "service-error" }
      : { label: "正在连接本地服务", shortLabel: "正在连接", className: "service-pending" };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

      <aside className="desktop-sidebar" aria-label="侧栏">
        <div className="brand-lockup">
          <span className="brand-mark"><Database aria-hidden="true" /></span>
          <span>
            <strong>Better Data</strong>
            <small>本地数据工作台</small>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          <p className="nav-section-label">工作区</p>
          <a className="nav-item nav-item-active" href="#workspace" aria-current="page">
            <Home aria-hidden="true" />工作台
          </a>
          <a className="nav-item" href="#projects">
            <FolderKanban aria-hidden="true" />最近项目
          </a>
          <a className="nav-item" href="#system-status">
            <ListChecks aria-hidden="true" />系统状态
          </a>
          <div className="nav-divider" />
          <p className="nav-section-label">系统</p>
          <button className="nav-item" type="button" onClick={openSettings}>
            <Settings aria-hidden="true" />设置
          </button>
          <button className="nav-item nav-item-disabled" type="button" disabled title="即将开放">
            <CircleHelp aria-hidden="true" />使用帮助<span className="nav-item-note">即将开放</span>
          </button>
        </nav>

        <div className="privacy-note">
          <div><ShieldCheck aria-hidden="true" /><strong>数据留在本机</strong></div>
          <p>解析、处理、报告与任务记录都不会上传到外部服务。</p>
        </div>
      </aside>

      <div className="page-frame">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><Database aria-hidden="true" /></span>
            <span><strong>Better Data</strong><small>数据工作台</small></span>
          </div>
          <div className="breadcrumb" aria-label="当前位置">
            <span>项目库</span><ChevronRight aria-hidden="true" /><strong>工作台</strong>
          </div>
          <Badge variant="outline" className={`service-badge ${serviceCopy.className}`}>
            {serviceState === "connecting" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <span className="service-dot" aria-hidden="true" />}
            <span className="service-label-long">{serviceCopy.label}</span>
            <span className="service-label-short">{serviceCopy.shortLabel}</span>
          </Badge>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          <section id="workspace" className="page-heading" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">数据工作台</p>
              <h1 id="page-title">从原始表格到可用数据</h1>
              <p>上传数据、审阅系统建议，然后执行一套可追踪、可调整、可复现的预处理流程。</p>
            </div>
            <Button size="lg" className="primary-action" onClick={openProjectDialog}>
              <Plus aria-hidden="true" />新建项目
            </Button>
          </section>

          {libraryInfo?.needs_setup && (
            <section className="setup-notice" aria-labelledby="setup-title">
              <FolderOpen aria-hidden="true" />
              <div>
                <h2 id="setup-title">确认项目库位置</h2>
                <p>首次使用请确认数据项目保存到哪个本机文件夹。当前默认位置仍可使用。</p>
              </div>
              <Button variant="outline" onClick={openSettings}>选择位置</Button>
            </section>
          )}

          <section className="metrics-grid" aria-labelledby="overview-title">
            <h2 id="overview-title" className="sr-only">项目概况</h2>
            {metrics.map((item) => (
              <article key={item.label} className="metric-card">
                <span className={`metric-icon metric-icon-${item.tone}`}><item.icon aria-hidden="true" /></span>
                <div>
                  <p>{item.label}</p>
                  <div><strong>{item.value}</strong><span>{item.note}</span></div>
                </div>
              </article>
            ))}
          </section>

          <div className="workspace-grid">
            <section className="panel upload-panel" aria-labelledby="upload-title">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">新建流程</p>
                  <h2 id="upload-title">导入一份表格</h2>
                  <p>系统将先检查字段结构、缺失值与潜在风险，不会立即修改原始数据。</p>
                </div>
                <span className="panel-header-icon"><FileSpreadsheet aria-hidden="true" /></span>
              </div>

              <div className="panel-body">
                <button
                  type="button"
                  className={`upload-zone ${dragging ? "upload-zone-active" : ""}`}
                  aria-describedby="upload-guidance upload-privacy"
                  onClick={(event) => {
                    dialogReturnFocusRef.current = event.currentTarget;
                    inputRef.current?.click();
                  }}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    dialogReturnFocusRef.current = event.currentTarget;
                    acceptFiles(event.dataTransfer.files);
                    setDialogOpen(true);
                  }}
                >
                  <span className="upload-icon"><UploadCloud aria-hidden="true" /></span>
                  <span className="upload-title">{dragging ? "松开鼠标以选择文件" : "拖放 CSV 或 XLSX 文件"}</span>
                  <span className="upload-subtitle">也可以点击此处浏览本机文件</span>
                  <span id="upload-guidance" className="upload-limits">CSV 最大 1 GB · XLSX 最大 200 MB</span>
                  <span id="upload-privacy" className="upload-privacy"><ShieldCheck aria-hidden="true" />仅在本机读取</span>
                </button>
                <input
                  ref={inputRef}
                  id="dataset-file"
                  className="sr-only"
                  type="file"
                  tabIndex={-1}
                  aria-hidden="true"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => { acceptFiles(event.target.files); setDialogOpen(true); }}
                />

                <ol className="process-steps" aria-label="处理步骤">
                  {[
                    ["01", "确认字段", "检查类型、目标列与敏感字段"],
                    ["02", "审阅建议", "了解每项处理的依据和影响"],
                    ["03", "导出结果", "获得数据、报告、记录与脚本"],
                  ].map(([index, title, note]) => (
                    <li key={index}>
                      <span>{index}</span>
                      <div><h3>{title}</h3><p>{note}</p></div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <aside id="system-status" className="side-column" aria-label="系统信息">
              <section className="system-panel" aria-labelledby="system-title">
                <div className="system-heading">
                  <div><p>本机处理能力</p><h2 id="system-title">运行环境</h2></div>
                  <Badge className={serviceState === "ready" ? "status-success" : serviceState === "unavailable" ? "status-error" : "status-neutral"}>
                    {serviceState === "ready" ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
                    {serviceState === "ready" ? "已就绪" : serviceState === "unavailable" ? "需启动" : "检查中"}
                  </Badge>
                </div>
                <dl className="system-list">
                  <div><dt>大型任务队列</dt><dd>{metrics[1].value === "0" ? "空闲" : `${metrics[1].value} 个运行中`}</dd></div>
                  <div><dt>项目库存储</dt><dd>{metrics[2].value}</dd></div>
                  <div><dt>项目库位置</dt><dd className="library-path" title={libraryInfo?.path}>{libraryInfo?.path ?? "读取中"}</dd></div>
                  <div><dt>外部数据传输</dt><dd><ShieldCheck aria-hidden="true" />已关闭</dd></div>
                </dl>
                {serviceState === "unavailable" && (
                  <p className="service-help" role="status"><Info aria-hidden="true" />启动本地后端服务后刷新页面，即可创建项目。</p>
                )}
              </section>

              <section className="local-note" aria-labelledby="local-title">
                <ShieldCheck aria-hidden="true" />
                <div><h2 id="local-title">本地优先</h2><p>页面关闭后，大型处理任务仍可继续；重新打开网站即可查看进度。</p></div>
              </section>
            </aside>
          </div>

          <section id="projects" className="panel projects-panel" aria-labelledby="projects-title">
            <div className="panel-header compact-header">
              <div><p className="panel-kicker">继续工作</p><h2 id="projects-title">最近项目</h2></div>
              <span className="project-count">共 {projects.length} 个</span>
            </div>
            <div className="projects-body">
              {projects.length ? (
                <ul className="project-list">
                  {projects.slice(0, 5).map((project) => {
                    const status = projectStatus(project.status);
                    return (
                      <li key={project.id} className="project-row">
                        <span className="project-icon"><FileSpreadsheet aria-hidden="true" /></span>
                        <div className="project-main">
                          <h3><Link href={`/projects/${project.id}`}>{project.name}</Link></h3>
                          <p>{project.source_filename}<span aria-hidden="true"> · </span>{formatBytes(project.source_size)}</p>
                        </div>
                        {project.profile && <span className="project-meta">{project.profile.column_count} 列 · 抽样 {project.profile.sampled_rows} 行</span>}
                        <Badge variant="outline" className={status.className}>{status.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="empty-state">
                  <span><FolderKanban aria-hidden="true" /></span>
                  <div><h3>还没有项目</h3><p>上传第一份表格后，可在这里继续配置和处理。</p></div>
                  <Button variant="outline" onClick={openProjectDialog}>选择文件</Button>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <a className="mobile-nav-item mobile-nav-active" href="#workspace" aria-current="page"><Home aria-hidden="true" /><span>工作台</span></a>
        <a className="mobile-nav-item" href="#projects"><FolderKanban aria-hidden="true" /><span>项目</span></a>
        <a className="mobile-nav-item" href="#system-status"><ListChecks aria-hidden="true" /><span>状态</span></a>
        <button className="mobile-nav-item" type="button" onClick={openSettings}><Settings aria-hidden="true" /><span>设置</span></button>
      </nav>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setSubmitError(null); }}>
        <DialogContent
          className="project-dialog"
          aria-describedby="project-dialog-description"
          onCloseAutoFocus={(event) => {
            if (!dialogReturnFocusRef.current) return;
            event.preventDefault();
            dialogReturnFocusRef.current.focus();
          }}
        >
          <DialogHeader className="dialog-header">
            <DialogTitle>创建数据项目</DialogTitle>
            <DialogDescription id="project-dialog-description">选择数据文件和任务类型。下一步仅做本地结构与质量检查。</DialogDescription>
          </DialogHeader>

          <div className="dialog-body">
            <div className="form-group">
              <p className="field-label">数据文件 <span aria-hidden="true">*</span></p>
              <button
                type="button"
                className="file-picker"
                aria-describedby={`file-helper${fileIssue || submitError ? " file-error" : ""}`}
                data-invalid={Boolean(fileIssue || submitError)}
                onClick={() => inputRef.current?.click()}
              >
                <span className="file-picker-icon"><FileSpreadsheet aria-hidden="true" /></span>
                {selectedFile ? (
                  <span className="file-picker-copy"><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)} · 点击可重新选择</small></span>
                ) : (
                  <span className="file-picker-copy"><strong>选择 CSV 或 XLSX 文件</strong><small>文件只会在本机读取</small></span>
                )}
                <span className="file-picker-action">浏览</span>
              </button>
              <p id="file-helper" className="field-helper">CSV 最大 1 GB，XLSX 最大 200 MB。</p>
              {(fileIssue || submitError) && <p id="file-error" className="field-error" role="alert">{fileIssue || submitError}</p>}
            </div>

            <fieldset className="form-group">
              <legend className="field-label">任务类型 <span aria-hidden="true">*</span></legend>
              <div className="task-grid">
                {taskTypes.map((type) => {
                  const active = taskType === type.label;
                  return (
                    <label
                      key={type.label}
                      className={`task-option ${active ? "task-option-active" : ""}`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="task-type"
                        value={type.code}
                        checked={active}
                        onChange={() => setTaskType(type.label)}
                      />
                      <span className="task-option-title">{active && <Check aria-hidden="true" />}{type.label}</span>
                      <span>{type.description}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>取消</Button>
            <Button
              disabled={!selectedFile || Boolean(fileIssue) || submitting}
              aria-busy={submitting}
              onClick={createProject}
            >
              {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {submitting ? "正在检查" : "创建并检查"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsError(null); }}>
        <DialogContent
          className="settings-dialog"
          aria-describedby="settings-dialog-description"
          onCloseAutoFocus={(event) => {
            if (!settingsReturnFocusRef.current) return;
            event.preventDefault();
            settingsReturnFocusRef.current.focus();
          }}
        >
          <DialogHeader className="dialog-header">
            <DialogTitle>项目库设置</DialogTitle>
            <DialogDescription id="settings-dialog-description">Better Data 会把原始文件副本、项目配置和处理结果保存在这个本机文件夹。</DialogDescription>
          </DialogHeader>
          <form
            className="settings-form"
            onSubmit={(event) => { event.preventDefault(); void saveProjectLibrary(); }}
          >
            <div className="settings-body">
              <div className="form-group">
                <label className="field-label" htmlFor="project-library-path">项目库绝对路径 <span aria-hidden="true">*</span></label>
                <Input
                  id="project-library-path"
                  className="settings-path-input"
                  value={libraryPath}
                  onChange={(event) => setLibraryPath(event.target.value)}
                  aria-describedby={`project-library-helper${settingsError ? " project-library-error" : ""}`}
                  aria-invalid={Boolean(settingsError)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="例如 D:\\Better Data Projects"
                />
                <p id="project-library-helper" className="field-helper">请选择空文件夹或已有 Better Data 项目库。普通非空文件夹不会被接管。</p>
                {settingsError && <p id="project-library-error" className="field-error" role="alert">{settingsError}</p>}
              </div>
              <div className="library-safety-note">
                <ShieldCheck aria-hidden="true" />
                <div><strong>安全保护</strong><p>系统会写入项目库标记，并拒绝覆盖普通非空文件夹。切换位置不会移动或删除原项目库。</p></div>
              </div>
            </div>
            <div className="dialog-actions">
              <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)} disabled={savingSettings}>取消</Button>
              <Button type="submit" disabled={!libraryPath.trim() || savingSettings} aria-busy={savingSettings}>
                {savingSettings ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {savingSettings ? "正在保存" : "保存项目库"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
