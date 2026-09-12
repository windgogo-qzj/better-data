import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const projectId = args.get("--project-id");
const baseUrl = (args.get("--base-url") ?? "http://localhost:5173").replace(/\/$/, "");
const outputDirectory = resolve(args.get("--output") ?? "docs/images");
const workflowQaDirectory = args.get("--workflow-qa-output")
  ? resolve(args.get("--workflow-qa-output"))
  : undefined;
const viewportWidth = Number(args.get("--width") ?? 1440);
const viewportHeight = Number(args.get("--height") ?? 900);

if (!projectId) {
  throw new Error("缺少 --project-id。请传入已完成全流程的脱敏演示项目 ID。");
}
if (!Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight) || viewportWidth < 320 || viewportHeight < 480) {
  throw new Error("截图视口无效。宽度至少为 320，高度至少为 480。");
}

const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
if (!edgePath) {
  throw new Error("未找到 Microsoft Edge。可通过 EDGE_PATH 指定浏览器路径。");
}

await mkdir(outputDirectory, { recursive: true });
if (workflowQaDirectory) await mkdir(workflowQaDirectory, { recursive: true });
const profileDirectory = join(tmpdir(), `better-data-readme-${process.pid}`);
const debuggingPort = 9235;
const edge = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${viewportWidth},${viewportHeight}`,
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let socket;
let requestId = 0;
const pending = new Map();

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Edge may still be starting.
    }
    await delay(100);
  }
  throw new Error("无法连接 Edge DevTools 调试端口。");
}

function send(method, params = {}, sessionId) {
  requestId += 1;
  const id = requestId;
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
  });
}

async function capture(sessionId, fileName, url, prepare, directory = outputDirectory) {
  await send("Page.navigate", { url }, sessionId);
  await delay(1_400);
  const inspection = await send(
    "Runtime.evaluate",
    {
      expression: `({ title: document.title, text: document.body?.innerText ?? "" })`,
      returnByValue: true,
    },
    sessionId,
  );
  const page = inspection.result.value;
  if (!page.text || page.text.includes("ERR_CONNECTION_REFUSED") || page.title.includes("无法访问")) {
    throw new Error(`页面未正确加载，停止截图：${url}`);
  }
  if (prepare) {
    await send(
      "Runtime.evaluate",
      { expression: prepare, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    await delay(700);
  }
  const result = await send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, captureBeyondViewport: false },
    sessionId,
  );
  const target = join(directory, fileName);
  await writeFile(target, Buffer.from(result.data, "base64"));
  process.stdout.write(`captured ${target}\n`);
}

try {
  const debuggerInfo = await waitForDebugger();
  socket = new WebSocket(debuggerInfo.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth < 768 },
    sessionId,
  );
  await send("Emulation.setScrollbarsHidden", { hidden: true }, sessionId);

  await capture(sessionId, "home-hero.png", `${baseUrl}/`);
  await capture(
    sessionId,
    "home-workflow.png",
    `${baseUrl}/`,
    `(() => {
      const workflow = document.querySelector("#workflow");
      const finalStage = document.querySelectorAll(".workflow-v3-nav button")[4];
      if (!workflow || !finalStage) throw new Error("找不到首页产品流程区域");
      finalStage.click();
      window.scrollTo({ top: workflow.offsetTop, behavior: "instant" });
    })()`,
  );
  await capture(sessionId, "create-project.png", `${baseUrl}/projects/new`);
  await capture(sessionId, "project-overview.png", `${baseUrl}/projects/${projectId}/overview`);
  await capture(sessionId, "quality-diagnosis.png", `${baseUrl}/projects/${projectId}/quality`);
  await capture(sessionId, "processing-results.png", `${baseUrl}/projects/${projectId}/results`);

  if (workflowQaDirectory) {
    for (let index = 0; index < 5; index += 1) {
      await capture(
        sessionId,
        `workflow-stage-${String(index + 1).padStart(2, "0")}.png`,
        `${baseUrl}/`,
        `(() => {
          const workflow = document.querySelector("#workflow");
          const stage = document.querySelectorAll(".workflow-v3-nav button")[${index}];
          if (!workflow || !stage) throw new Error("找不到首页产品流程区域");
          stage.click();
          const target = window.innerWidth < 768
            ? document.querySelector(".workflow-material")
            : workflow;
          window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top, behavior: "instant" });
        })()`,
        workflowQaDirectory,
      );
    }
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  edge.kill();
  await delay(200);
  await rm(profileDirectory, { recursive: true, force: true });
}
