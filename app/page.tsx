"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  ChevronRight,
  CircleHelp,
  Database,
  FileSpreadsheet,
  FolderKanban,
  HardDrive,
  Home,
  ListChecks,
  Plus,
  Settings,
  ShieldCheck,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const taskTypes = ["分类", "回归", "聚类预处理", "纯数据清洗"] as const;
const taskTypeCodes = {
  分类: "classification",
  回归: "regression",
  聚类预处理: "clustering_prep",
  纯数据清洗: "cleaning",
} as const;
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
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [taskType, setTaskType] = useState<(typeof taskTypes)[number]>("分类");
  const [dragging, setDragging] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((response) => response.ok ? response.json() : [])
      .then((records: ProjectSummary[]) => setProjects(records))
      .catch(() => undefined);
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
          taskType: { type: "string", enum: Object.values(taskTypeCodes) },
        },
        required: ["taskType"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const value = typeof input === "object" && input !== null && "taskType" in input
          ? String((input as { taskType: unknown }).taskType)
          : "";
        const selected = taskTypes.find((label) => taskTypeCodes[label] === value);
        if (!selected) throw new Error("不支持的任务类型");
        setTaskType(selected);
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
      return "目前仅支持 CSV 和 XLSX 文件";
    }
    const limit = extension === "csv" ? 1024 : 200;
    if (selectedFile.size > limit * 1024 * 1024) {
      return `${extension.toUpperCase()} 文件不能超过 ${limit} MB`;
    }
    return null;
  }, [selectedFile]);

  function acceptFiles(files: FileList | null) {
    if (files?.[0]) setSelectedFile(files[0]);
  }

  async function createProject() {
    if (!selectedFile || fileIssue) return;
    setSubmitting(true);
    setSubmitError(null);
    const form = new FormData();
    form.append("name", selectedFile.name.replace(/\.(csv|xlsx)$/i, ""));
    form.append("task_type", taskTypeCodes[taskType]);
    form.append("dataset", selectedFile);
    try {
      const response = await fetch(`${API_BASE}/api/projects`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "项目创建失败");
      setProjects((current) => [payload as ProjectSummary, ...current]);
      setDialogOpen(false);
      setSelectedFile(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法连接本地处理服务");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/10 bg-[#0b1736] text-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <div className="grid size-10 place-items-center rounded-xl bg-[#6ae0c1] text-[#071630] shadow-[0_8px_24px_rgba(106,224,193,.24)]">
            <Database className="size-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[17px] font-semibold tracking-tight">Better Data</div>
            <div className="text-xs text-slate-400">本地数据工作台</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5" aria-label="主导航">
          <p className="px-3 pb-2 text-xs font-medium text-slate-500">工作区</p>
          <a className="nav-item nav-item-active" href="#workspace"><Home className="size-[18px]" />首页</a>
          <a className="nav-item" href="#projects"><FolderKanban className="size-[18px]" />项目</a>
          <a className="nav-item" href="#tasks"><ListChecks className="size-[18px]" />处理任务</a>
          <div className="my-5 border-t border-white/10" />
          <p className="px-3 pb-2 text-xs font-medium text-slate-500">系统</p>
          <a className="nav-item" href="#settings"><Settings className="size-[18px]" />设置</a>
          <a className="nav-item" href="#help"><CircleHelp className="size-[18px]" />使用帮助</a>
        </nav>

        <div className="m-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-[#6ae0c1]" />数据留在本机</div>
          <p className="text-xs leading-5 text-slate-400">分析、处理与报告均在本地完成。</p>
        </div>
      </aside>

      <section className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="grid size-9 place-items-center rounded-xl bg-[#0b1736] text-[#6ae0c1]"><Database className="size-[18px]" /></div>
            <span className="font-semibold">Better Data</span>
          </div>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <span>项目库</span><ChevronRight className="size-4" /><span className="text-foreground">工作台</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-8 gap-2 rounded-full border-emerald-200 bg-emerald-50 px-3 font-medium text-emerald-700"><span className="size-2 rounded-full bg-emerald-500" />离线运行</Badge>
            <Button variant="ghost" size="icon" aria-label="通知"><Bell className="size-[18px]" /></Button>
          </div>
        </header>

        <div id="workspace" className="mx-auto w-full max-w-[1420px] px-5 py-8 sm:px-8 sm:py-10">
          <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-sm font-medium text-[#167f73]">数据工作台</p>
              <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">从原始表格到可用数据</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">上传数据，检查系统建议，再执行一套可追踪、可复现的预处理流程。</p>
            </div>
            <Button className="h-11 gap-2 rounded-xl bg-[#0b1736] px-5 text-white hover:bg-[#142651]" onClick={() => setDialogOpen(true)}><Plus className="size-4" />新建项目</Button>
          </div>

          <section className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="项目概况">
            {[
              { label: "本地项目", value: String(projects.length), note: projects.length ? "保存在本机" : "还没有项目", icon: FolderKanban, tone: "blue" },
              { label: "运行中任务", value: "0", note: "队列空闲", icon: Activity, tone: "green" },
              { label: "项目库占用", value: "0 B", note: "存储空间充足", icon: HardDrive, tone: "amber" },
            ].map((item) => (
              <article key={item.label} className="metric-card">
                <div className={`metric-icon metric-icon-${item.tone}`}><item.icon className="size-5" /></div>
                <div><p className="text-sm text-muted-foreground">{item.label}</p><div className="mt-1 flex items-baseline gap-2"><strong className="text-2xl font-semibold">{item.value}</strong><span className="text-xs text-muted-foreground">{item.note}</span></div></div>
              </article>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_18px_50px_rgba(16,35,66,.06)]">
              <div className="border-b border-border px-6 py-5 sm:px-7">
                <div className="flex items-center justify-between">
                  <div><h2 className="text-lg font-semibold">开始第一个项目</h2><p className="mt-1 text-sm text-muted-foreground">选择一份表格，系统会先检查结构与质量。</p></div>
                  <FileSpreadsheet className="size-6 text-[#167f73]" />
                </div>
              </div>
              <div className="p-5 sm:p-7">
                <button
                  type="button"
                  className={`upload-zone ${dragging ? "upload-zone-active" : ""}`}
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFiles(event.dataTransfer.files); setDialogOpen(true); }}
                >
                  <span className="upload-icon"><UploadCloud className="size-7" /></span>
                  <span className="text-base font-semibold">拖放 CSV 或 XLSX 文件</span>
                  <span className="text-sm text-muted-foreground">或者点击选择本机文件</span>
                  <span className="mt-2 text-xs text-muted-foreground">CSV 最大 1 GB · XLSX 最大 200 MB</span>
                </button>
                <input ref={inputRef} className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => { acceptFiles(event.target.files); setDialogOpen(true); }} />

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {[
                    ["01", "确认字段", "检查类型、目标列与敏感字段"],
                    ["02", "审阅建议", "了解每项处理的依据和风险"],
                    ["03", "导出结果", "获得数据、报告和复现脚本"],
                  ].map(([index, title, note]) => (
                    <div key={index} className="rounded-2xl bg-secondary/70 p-4"><span className="text-xs font-semibold text-[#167f73]">{index}</span><h3 className="mt-2 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p></div>
                  ))}
                </div>
              </div>
            </article>

            <aside className="space-y-6">
              <article className="rounded-3xl bg-[#0b1736] p-6 text-white shadow-[0_18px_50px_rgba(11,23,54,.18)]">
                <div className="mb-6 flex items-center justify-between"><h2 className="font-semibold">本机处理能力</h2><Badge className="border-0 bg-white/10 text-slate-200">已就绪</Badge></div>
                <dl className="space-y-4 text-sm">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4"><dt className="text-slate-400">大型任务队列</dt><dd>空闲</dd></div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-4"><dt className="text-slate-400">项目库</dt><dd>等待选择</dd></div>
                  <div className="flex items-center justify-between"><dt className="text-slate-400">外部数据传输</dt><dd className="text-[#6ae0c1]">已关闭</dd></div>
                </dl>
              </article>

              <article id="projects" className="rounded-3xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">最近项目</h2><Button variant="ghost" size="sm" className="text-muted-foreground">查看全部</Button></div>
                {projects.length ? (
                  <div className="space-y-2">
                    {projects.slice(0, 3).map((project) => (
                      <div key={project.id} className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/35 p-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#167f73]"><FileSpreadsheet className="size-[18px]" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{project.name}</p><p className="truncate text-xs text-muted-foreground">{project.source_filename} · {formatBytes(project.source_size)}</p></div>
                        <Badge variant="outline" className="shrink-0">{project.status === "ready" ? "待确认" : project.status}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-secondary/40 px-5 py-8 text-center"><FolderKanban className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">暂无项目</p><p className="mt-1 text-xs text-muted-foreground">创建后可在这里继续处理</p></div>
                )}
              </article>
            </aside>
          </section>
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl rounded-3xl p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-6 py-5 text-left"><DialogTitle>创建数据项目</DialogTitle><DialogDescription>选择数据文件和后续任务，下一步将进行本地结构检查。</DialogDescription></DialogHeader>
          <div className="space-y-6 px-6 py-5">
            <div>
              <p className="mb-2 text-sm font-medium">数据文件</p>
              <button type="button" className="flex w-full items-center gap-4 rounded-2xl border border-border bg-secondary/50 p-4 text-left hover:border-[#65b9ac]" onClick={() => inputRef.current?.click()}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#167f73] shadow-sm"><FileSpreadsheet className="size-5" /></span>
                {selectedFile ? <span className="min-w-0"><strong className="block truncate text-sm">{selectedFile.name}</strong><span className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</span></span> : <span><strong className="block text-sm">选择 CSV 或 XLSX 文件</strong><span className="text-xs text-muted-foreground">数据只会在本机读取</span></span>}
              </button>
              {(fileIssue || submitError) && <p className="mt-2 text-sm text-destructive">{fileIssue || submitError}</p>}
            </div>

            <fieldset>
              <legend className="mb-3 text-sm font-medium">任务类型</legend>
              <div className="grid grid-cols-2 gap-2">
                {taskTypes.map((type) => <button key={type} type="button" className={`task-option ${taskType === type ? "task-option-active" : ""}`} onClick={() => setTaskType(type)}>{type}</button>)}
              </div>
            </fieldset>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border bg-secondary/30 px-6 py-4"><Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>取消</Button><Button className="bg-[#0b1736] text-white hover:bg-[#142651]" disabled={!selectedFile || Boolean(fileIssue) || submitting} onClick={createProject}>{submitting && <LoaderCircle className="size-4 animate-spin" />}{submitting ? "正在检查" : "创建并检查"}</Button></div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
