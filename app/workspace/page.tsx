"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  FileSpreadsheet,
  FolderKanban,
  HardDrive,
  Home,
  Info,
  ListChecks,
  Plus,
  Save,
  Settings,
  ShieldCheck,
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type ServiceState = "connecting" | "ready" | "unavailable";

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
      execute: () => Promise<object>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

const taskLabels: Record<string, string> = {
  classification: "分类",
  regression: "回归",
  clustering_prep: "聚类预处理",
  cleaning: "纯数据清洗",
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
  if (["complete", "completed", "processed"].includes(status)) return { label: "已处理", className: "status-success" };
  if (status === "failed") return { label: "失败", className: "status-error" };
  return { label: status, className: "status-neutral" };
}

export default function WorkspacePage() {
  const router = useRouter();
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [serviceState, setServiceState] = useState<ServiceState>("connecting");
  const [libraryInfo, setLibraryInfo] = useState<ProjectLibraryInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryPath, setLibraryPath] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [announcement, setAnnouncement] = useState("");

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
      description: "打开 Better Data 的新建项目页面。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        router.push("/projects/new");
        return { status: "opened" };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [router]);

  const metrics = useMemo(() => {
    const activeCount = projects.filter((project) => ["processing", "running"].includes(project.status)).length;
    const storage = projects.reduce((total, project) => total + project.source_size, 0);
    return [
      { label: "本地项目", value: String(projects.length), note: projects.length ? "保存在本机" : "还没有项目", icon: FolderKanban, tone: "blue" },
      { label: "运行中任务", value: String(activeCount), note: activeCount ? "后台处理中" : "队列空闲", icon: Activity, tone: "green" },
      { label: "项目库占用", value: formatBytes(storage), note: "原始文件统计", icon: HardDrive, tone: "amber" },
    ];
  }, [projects]);

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

  const serviceCopy = serviceState === "ready"
    ? { label: "本地服务已连接", className: "service-ready" }
    : serviceState === "unavailable"
      ? { label: "本地服务未连接", className: "service-error" }
      : { label: "正在连接本地服务", className: "service-pending" };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

      <aside className="desktop-sidebar" aria-label="侧栏">
        <div className="brand-lockup">
          <span className="brand-mark"><Database aria-hidden="true" /></span>
          <span><strong>Better Data</strong><small>本地数据工作台</small></span>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          <p className="nav-section-label">工作区</p>
          <Link className="nav-item nav-item-active" href="/workspace" aria-current="page"><Home aria-hidden="true" />项目库</Link>
          <a className="nav-item" href="#projects"><FolderKanban aria-hidden="true" />最近项目</a>
          <a className="nav-item" href="#system-status"><ListChecks aria-hidden="true" />系统状态</a>
          <div className="nav-divider" />
          <p className="nav-section-label">系统</p>
          <button className="nav-item" type="button" onClick={openSettings}><Settings aria-hidden="true" />设置</button>
          <button className="nav-item nav-item-disabled" type="button" disabled title="即将开放"><CircleHelp aria-hidden="true" />使用帮助<span>即将开放</span></button>
        </nav>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Database aria-hidden="true" /></span><strong>Better Data</strong></div>
          <div className="breadcrumb"><span>工作区</span><ChevronRight aria-hidden="true" /><strong>项目库</strong></div>
          <div className={`service-badge ${serviceCopy.className}`} role="status"><span className="service-dot" aria-hidden="true" />{serviceCopy.label}</div>
        </header>

        <main id="main-content" className="main-content">
          <section className="page-heading" aria-labelledby="workspace-title">
            <div><p className="panel-kicker">项目工作台</p><h1 id="workspace-title">继续你的数据处理工作</h1><p>查看最近项目，或者创建一套新的可追踪预处理流程。</p></div>
            <Link className="workspace-primary-link" href="/projects/new"><Plus aria-hidden="true" />新建项目</Link>
          </section>

          <section className="metrics-grid" aria-label="项目概览">
            {metrics.map(({ label, value, note, icon: Icon, tone }) => (
              <article className="metric-card" key={label}>
                <span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span>
                <div><p>{label}</p><div><strong>{value}</strong><span>{note}</span></div></div>
              </article>
            ))}
          </section>

          <div className="workspace-grid workspace-library-grid">
            <section id="projects" className="panel projects-panel workspace-projects" aria-labelledby="projects-title">
              <div className="panel-header compact-header">
                <div><p className="panel-kicker">继续工作</p><h2 id="projects-title">最近项目</h2></div>
                <span className="project-count">共 {projects.length} 个</span>
              </div>
              <div className="projects-body">
                {projects.length ? (
                  <ul className="project-list">
                    {projects.slice(0, 8).map((project) => {
                      const status = projectStatus(project.status);
                      const xlsx = project.source_filename.toLowerCase().endsWith(".xlsx");
                      return (
                        <li key={project.id} className="project-row">
                          <span className="project-icon"><FileSpreadsheet aria-hidden="true" /></span>
                          <div className="project-main">
                            <h3><Link href={`/projects/${project.id}/overview`}>{project.name}</Link></h3>
                            <p>{taskLabels[project.task_type] ?? project.task_type}<span aria-hidden="true"> · </span>{project.source_filename}<span aria-hidden="true"> · </span>{formatBytes(project.source_size)}</p>
                          </div>
                          {project.profile && <span className="project-meta">{project.profile.column_count} 列 · {project.profile.sampled_rows} 行画像</span>}
                          {xlsx && <Badge variant="outline" className="status-info">仅预览</Badge>}
                          <Badge variant="outline" className={status.className}>{status.label}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="empty-state">
                    <span><FolderKanban aria-hidden="true" /></span>
                    <div><h3>还没有项目</h3><p>创建第一套数据处理流程后，可以从这里继续。</p></div>
                    <Link className="workspace-secondary-link" href="/projects/new">新建项目</Link>
                  </div>
                )}
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
                {serviceState === "unavailable" && <p className="service-help" role="status"><Info aria-hidden="true" />启动本地后端服务后刷新页面。</p>}
              </section>
            </aside>
          </div>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <Link className="mobile-nav-item mobile-nav-active" href="/workspace" aria-current="page"><Home aria-hidden="true" /><span>项目</span></Link>
        <Link className="mobile-nav-item" href="/projects/new"><Plus aria-hidden="true" /><span>新建</span></Link>
        <a className="mobile-nav-item" href="#system-status"><ListChecks aria-hidden="true" /><span>状态</span></a>
        <button className="mobile-nav-item" type="button" onClick={openSettings}><Settings aria-hidden="true" /><span>设置</span></button>
      </nav>

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
            <DialogDescription id="settings-dialog-description">设置项目、原始副本、中间文件和结果的本机保存位置。</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <div className="form-group">
              <label className="field-label" htmlFor="project-library-path">项目库绝对路径 <span aria-hidden="true">*</span></label>
              <Input id="project-library-path" value={libraryPath} onChange={(event) => setLibraryPath(event.target.value)} aria-describedby={`project-library-helper${settingsError ? " project-library-error" : ""}`} aria-invalid={Boolean(settingsError)} placeholder="例如 D:\\BetterDataProjects" />
              <p id="project-library-helper" className="field-helper">请选择空文件夹或已有 Better Data 项目库。普通非空文件夹不会被接管。</p>
              {settingsError && <p id="project-library-error" className="field-error" role="alert">{settingsError}</p>}
            </div>
            <div className="settings-safety-note"><ShieldCheck aria-hidden="true" /><div><strong>安全保护</strong><p>系统会写入项目库标记，并拒绝覆盖普通非空文件夹。切换位置不会移动或删除原项目库。</p></div></div>
          </div>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={savingSettings}>取消</Button>
            <Button onClick={saveProjectLibrary} disabled={savingSettings || !libraryPath.trim()} aria-busy={savingSettings}><Save aria-hidden="true" />{savingSettings ? "正在保存" : "保存项目库"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
