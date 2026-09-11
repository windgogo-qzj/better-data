"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ChevronRight,
  CircleHelp,
  Database,
  FileSpreadsheet,
  FolderKanban,
  HardDrive,
  Home,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type ServiceState = "connecting" | "ready" | "unavailable";
type LibraryView = "projects" | "trash";

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

type TrashedProject = ProjectSummary & { trashed_at: string };

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function projectStatus(status: string) {
  if (status === "ready") return { label: "待确认", className: "status-warning" };
  if (["processing", "running"].includes(status)) return { label: "处理中", className: "status-info" };
  if (["complete", "completed", "processed"].includes(status)) return { label: "已处理", className: "status-success" };
  if (status === "failed") return { label: "失败", className: "status-error" };
  return { label: status, className: "status-neutral" };
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch/i.test(error.message))) {
    return "无法连接本地处理服务，请确认服务仍在运行后重试。";
  }
  return error instanceof Error ? error.message : fallback;
}

export default function WorkspacePage() {
  const router = useRouter();
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<TrashedProject[]>([]);
  const [serviceState, setServiceState] = useState<ServiceState>("connecting");
  const [libraryInfo, setLibraryInfo] = useState<ProjectLibraryInfo | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>("projects");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryPath, setLibraryPath] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ project: ProjectSummary; permanent: boolean } | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [undoProject, setUndoProject] = useState<TrashedProject | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_BASE}/api/projects`, { signal: controller.signal }),
      fetch(`${API_BASE}/api/trash`, { signal: controller.signal }),
      fetch(`${API_BASE}/api/settings/project-library`, { signal: controller.signal }),
    ])
      .then(async ([projectsResponse, trashResponse, libraryResponse]) => {
        if (!projectsResponse.ok || !trashResponse.ok || !libraryResponse.ok) {
          throw new Error("本地服务返回异常");
        }
        const [records, trash, projectLibrary] = await Promise.all([
          projectsResponse.json() as Promise<ProjectSummary[]>,
          trashResponse.json() as Promise<TrashedProject[]>,
          libraryResponse.json() as Promise<ProjectLibraryInfo>,
        ]);
        return { records, trash, projectLibrary };
      })
      .then(({ records, trash, projectLibrary }) => {
        setProjects(records);
        setTrashedProjects(trash);
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

  const summary = useMemo(() => {
    const activeCount = projects.filter((project) => ["processing", "running"].includes(project.status)).length;
    const storage = projects.reduce((total, project) => total + project.source_size, 0);
    return { activeCount, storage };
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const source = libraryView === "projects" ? projects : trashedProjects;
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return source;
    return source.filter((project) =>
      [project.name, project.source_filename, taskLabels[project.task_type] ?? project.task_type]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)),
    );
  }, [libraryView, projects, query, trashedProjects]);

  function openSettings(event?: MouseEvent<HTMLButtonElement>) {
    settingsReturnFocusRef.current = event?.currentTarget ?? null;
    setLibraryPath(libraryInfo?.path ?? "");
    setSettingsError(null);
    setSettingsOpen(true);
  }

  async function reloadLibrary() {
    const [projectsResponse, trashResponse] = await Promise.all([
      fetch(`${API_BASE}/api/projects`),
      fetch(`${API_BASE}/api/trash`),
    ]);
    if (!projectsResponse.ok || !trashResponse.ok) {
      throw new Error("项目状态刷新失败，请确认本地服务仍在运行。");
    }
    const [nextProjects, nextTrash] = await Promise.all([
      projectsResponse.json() as Promise<ProjectSummary[]>,
      trashResponse.json() as Promise<TrashedProject[]>,
    ]);
    setProjects(nextProjects);
    setTrashedProjects(nextTrash);
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
      await reloadLibrary();
      setSettingsOpen(false);
      setAnnouncement(`项目库已保存到“${updated.path}”。`);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "无法连接本地处理服务，请稍后重试。");
    } finally {
      setSavingSettings(false);
    }
  }

  async function confirmDelete(target: { project: ProjectSummary; permanent: boolean }) {
    const { project, permanent } = target;
    const url = permanent
      ? `${API_BASE}/api/trash/${project.id}`
      : `${API_BASE}/api/projects/${project.id}`;
    setDeleteInProgress(true);
    setAnnouncement("");
    try {
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(payload.detail ?? "删除失败，请稍后重试。");
      }
      if (permanent) {
        setTrashedProjects((current) => current.filter((item) => item.id !== project.id));
        await reloadLibrary();
        setAnnouncement(`“${project.name}”已永久删除。`);
      } else {
        const trashed = await response.json() as TrashedProject;
        setProjects((current) => current.filter((item) => item.id !== project.id));
        setTrashedProjects((current) => [trashed, ...current]);
        await reloadLibrary();
        setUndoProject(trashed);
        setAnnouncement(`“${project.name}”已移到回收站，可撤销。`);
      }
    } catch (error) {
      setAnnouncement(requestErrorMessage(error, "删除失败，请稍后重试。"));
    } finally {
      setDeleteInProgress(false);
      setPendingDelete(null);
    }
  }

  async function restoreProject(project: TrashedProject) {
    try {
      const response = await fetch(`${API_BASE}/api/trash/${project.id}/restore`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(payload.detail ?? "恢复失败，请稍后重试。");
      }
      const restored = await response.json() as ProjectSummary;
      setTrashedProjects((current) => current.filter((item) => item.id !== project.id));
      setProjects((current) => [restored, ...current]);
      await reloadLibrary();
      setUndoProject((current) => current?.id === project.id ? null : current);
      setAnnouncement(`“${project.name}”已恢复到项目库。`);
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "恢复失败，请稍后重试。");
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
        <Link className="brand-lockup" href="/" aria-label="返回 Better Data 首页">
          <span className="brand-mark"><Database aria-hidden="true" /></span>
          <span><strong>Better Data</strong><small>本地数据工作台</small></span>
        </Link>
        <nav className="sidebar-nav" aria-label="主导航">
          <p className="nav-section-label">工作区</p>
          <Link className="nav-item nav-item-active" href="/workspace" aria-current="page"><Home aria-hidden="true" />项目库</Link>
          <div className="nav-divider" />
          <p className="nav-section-label">系统</p>
          <button className="nav-item" type="button" onClick={openSettings}><Settings aria-hidden="true" />设置</button>
          <button className="nav-item nav-item-disabled" type="button" disabled title="即将开放"><CircleHelp aria-hidden="true" />使用帮助<span>即将开放</span></button>
        </nav>
        <div className="sidebar-privacy"><ShieldCheck aria-hidden="true" /><span><strong>仅在本机处理</strong><small>外部数据传输已关闭</small></span></div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <Link className="mobile-brand" href="/" aria-label="返回 Better Data 首页"><span className="brand-mark"><Database aria-hidden="true" /></span><strong>Better Data</strong></Link>
          <div className="breadcrumb"><span>工作区</span><ChevronRight aria-hidden="true" /><strong>项目库</strong></div>
          <div className={`service-badge ${serviceCopy.className}`} role="status"><span className="service-dot" aria-hidden="true" />{serviceCopy.label}</div>
        </header>

        <main id="main-content" className="main-content workspace-main">
          <section className="page-heading workspace-heading" aria-labelledby="workspace-title">
            <div><p className="panel-kicker">项目库</p><h1 id="workspace-title">你的数据项目</h1><p>从上次停下的位置继续，或者创建一套新的可追踪处理流程。</p></div>
            <Link className="workspace-primary-link" href="/projects/new"><Plus aria-hidden="true" />新建项目</Link>
          </section>

          <dl className="workspace-summary" aria-label="工作区摘要">
            <div><dt><FolderKanban aria-hidden="true" />本地项目</dt><dd>{projects.length}</dd></div>
            <div><dt><Activity aria-hidden="true" />运行中</dt><dd>{summary.activeCount || "空闲"}</dd></div>
            <div><dt><HardDrive aria-hidden="true" />项目库占用</dt><dd>{formatBytes(summary.storage)}</dd></div>
            <div><dt><ShieldCheck aria-hidden="true" />处理环境</dt><dd>{serviceState === "ready" ? "本机就绪" : serviceState === "unavailable" ? "需要启动" : "检查中"}</dd></div>
          </dl>

          <section className="project-commandbar" aria-label="项目库筛选">
            <div className="library-tabs" role="tablist" aria-label="项目视图">
              <button type="button" role="tab" aria-selected={libraryView === "projects"} onClick={() => setLibraryView("projects")}>全部项目 <span>{projects.length}</span></button>
              <button type="button" role="tab" aria-selected={libraryView === "trash"} onClick={() => setLibraryView("trash")}>回收站 <span>{trashedProjects.length}</span></button>
            </div>
            <label className="project-search">
              <span className="sr-only">搜索项目</span>
              <Search aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或文件" />
            </label>
          </section>

          <section className="project-library" aria-labelledby="projects-title">
            <header className="project-library-header">
              <div><h2 id="projects-title">{libraryView === "projects" ? "全部项目" : "回收站"}</h2><p>{libraryView === "projects" ? "按最近创建排序" : "项目可恢复，永久删除后无法撤销"}</p></div>
              <span>{visibleProjects.length} 个结果</span>
            </header>

            {visibleProjects.length ? (
              <ul className="project-list">
                {visibleProjects.map((project) => {
                  const status = projectStatus(project.status);
                  const inTrash = libraryView === "trash";
                  const trashed = project as TrashedProject;
                  const busy = ["processing", "running"].includes(project.status);
                  return (
                    <li key={project.id} className="project-row">
                      <span className="project-icon"><FileSpreadsheet aria-hidden="true" /></span>
                      <div className="project-main">
                        <h3>{inTrash ? project.name : <Link href={`/projects/${project.id}/overview`}>{project.name}</Link>}</h3>
                        <p>{taskLabels[project.task_type] ?? project.task_type}<span aria-hidden="true"> · </span>{project.source_filename}<span aria-hidden="true"> · </span>{formatBytes(project.source_size)}</p>
                      </div>
                      <div className="project-detail">
                        {project.profile && <span>{project.profile.column_count} 列 · {project.profile.sampled_rows} 行画像</span>}
                        <time dateTime={inTrash ? trashed.trashed_at : project.created_at}>
                          {inTrash ? `移除于 ${formatDate(trashed.trashed_at)}` : formatDate(project.created_at)}
                        </time>
                      </div>
                      {!inTrash && <Badge variant="outline" className={status.className}>{status.label}</Badge>}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="project-actions" type="button" aria-label={`管理项目“${project.name}”`}><MoreHorizontal aria-hidden="true" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {inTrash ? (
                            <>
                              <DropdownMenuItem onSelect={() => void restoreProject(trashed)}><RotateCcw aria-hidden="true" />恢复项目</DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete({ project, permanent: true })}><Trash2 aria-hidden="true" />永久删除</DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem disabled={busy} variant="destructive" onSelect={() => setPendingDelete({ project, permanent: false })}><Trash2 aria-hidden="true" />{busy ? "处理中，暂不可删除" : "移到回收站"}</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty-state">
                <span>{libraryView === "projects" ? <FolderKanban aria-hidden="true" /> : <Trash2 aria-hidden="true" />}</span>
                <div>
                  <h3>{query ? "没有匹配的项目" : libraryView === "projects" ? "还没有项目" : "回收站是空的"}</h3>
                  <p>{query ? "试试项目名称、文件名或任务类型。" : libraryView === "projects" ? "创建第一套数据处理流程后，可以从这里继续。" : "移除的项目会先保留在这里。"}</p>
                </div>
                {!query && libraryView === "projects" && <Link className="workspace-secondary-link" href="/projects/new">新建项目</Link>}
              </div>
            )}
          </section>

          <p className="workspace-library-path" title={libraryInfo?.path}>项目库位置：{libraryInfo?.path ?? "读取中"}</p>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <Link className="mobile-nav-item mobile-nav-active" href="/workspace" aria-current="page"><Home aria-hidden="true" /><span>项目</span></Link>
        <Link className="mobile-nav-item" href="/projects/new"><Plus aria-hidden="true" /><span>新建</span></Link>
        <button className="mobile-nav-item" type="button" onClick={openSettings}><Settings aria-hidden="true" /><span>设置</span></button>
      </nav>

      {undoProject && (
        <div className="workspace-undo" role="status">
          <span>“{undoProject.name}”已移到回收站</span>
          <button type="button" onClick={() => void restoreProject(undoProject)}>撤销</button>
          <button type="button" aria-label="关闭提示" onClick={() => setUndoProject(null)}><X aria-hidden="true" /></button>
        </div>
      )}

      {announcement && !undoProject && (
        <div className="workspace-feedback" role="status">
          <span>{announcement}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setAnnouncement("")}><X aria-hidden="true" /></button>
        </div>
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteInProgress) setPendingDelete(null);
        }}
      >
        <AlertDialogContent aria-busy={deleteInProgress}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.permanent ? "永久删除这个项目？" : "将项目移到回收站？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.permanent
                ? `“${pendingDelete.project.name}”的原始副本、处理中间文件和结果将永久删除，此操作无法撤销。`
                : `“${pendingDelete?.project.name}”会从项目库移到回收站，你之后仍可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInProgress}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant={pendingDelete?.permanent ? "destructive" : "default"}
              disabled={!pendingDelete || deleteInProgress}
              onClick={() => {
                if (pendingDelete) void confirmDelete(pendingDelete);
              }}
            >
              {deleteInProgress
                ? pendingDelete?.permanent ? "正在永久删除…" : "正在移动…"
                : pendingDelete?.permanent ? "永久删除" : "移到回收站"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
