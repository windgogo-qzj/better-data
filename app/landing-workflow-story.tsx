"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Download, FileSearch, Play, ShieldCheck, SlidersHorizontal } from "lucide-react";

type Stage = {
  id: string;
  number: string;
  title: string;
  description: string;
  evidence: string;
  outcome: string;
  visualLabel: string;
  visualValue: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
};

const stages: Stage[] = [
  {
    id: "inspect",
    number: "01",
    title: "先看清数据",
    description: "自动检查缺失值、重复记录、类型异常与类别不一致，原始文件保持不变。",
    evidence: "94 个字段已完成结构检查",
    outcome: "问题被定位到具体字段与记录",
    visualLabel: "发现",
    visualValue: "3 类问题",
    icon: FileSearch,
  },
  {
    id: "explain",
    number: "02",
    title: "理解处理依据",
    description: "建议同时说明问题证据、风险、置信度、预计影响与可选方案。",
    evidence: "规则 BD-MISSING-01，高置信度",
    outcome: "先理解影响，再决定是否采用",
    visualLabel: "依据",
    visualValue: "证据完整",
    icon: SlidersHorizontal,
  },
  {
    id: "confirm",
    number: "03",
    title: "由你确认规则",
    description: "确认字段角色与处理方案。系统负责解释和执行，不替你擅自修改。",
    evidence: "字段角色、规则与参数均可复核",
    outcome: "最终决定权留在数据人员手中",
    visualLabel: "权限",
    visualValue: "由你确认",
    icon: Check,
  },
  {
    id: "process",
    number: "04",
    title: "按数据边界执行",
    description: "训练集学习填充值与类别词表，测试集只应用已确认的规则，避免信息泄漏。",
    evidence: "固定随机种子，可重复执行",
    outcome: "训练与测试边界始终清晰",
    visualLabel: "边界",
    visualValue: "80 / 20",
    icon: Play,
  },
  {
    id: "deliver",
    number: "05",
    title: "带着记录交付",
    description: "导出处理后的 CSV、离线 HTML 报告和完整运行记录。",
    evidence: "数据、报告、规则记录同步生成",
    outcome: "结果可以复核，也可以重新执行",
    visualLabel: "交付",
    visualValue: "CSV + HTML",
    icon: Download,
  },
];

function WorkflowMaterial({ stage }: { stage: Stage }) {
  const visual = {
    inspect: (
      <div className="workflow-visual-inspect">
        <span><i>客户编号</i><b>A-101</b><em>正常</em></span>
        <span><i>年龄</i><b>空值</b><em>缺失</em></span>
        <span><i>地区</i><b>华 東</b><em>异体</em></span>
        <span><i>客户编号</i><b>A-101</b><em>重复</em></span>
      </div>
    ),
    explain: (
      <div className="workflow-visual-explain">
        <div><span>问题</span><strong>年龄缺失 18%</strong></div>
        <i aria-hidden="true" />
        <div><span>依据</span><strong>中位数更稳健</strong></div>
        <i aria-hidden="true" />
        <div><span>影响</span><strong>保留 175 条记录</strong></div>
      </div>
    ),
    confirm: (
      <div className="workflow-visual-confirm">
        <span className="workflow-confirm-ring"><Check aria-hidden="true" /></span>
        <p>字段角色已确认</p>
        <strong>规则由你决定</strong>
        <div><span>中位数填充</span><em>采用</em></div>
        <div><span>删除缺失行</span><em>不采用</em></div>
      </div>
    ),
    process: (
      <div className="workflow-visual-process">
        <div className="workflow-process-source"><span>原始数据</span><strong>973 行</strong></div>
        <div className="workflow-process-line" aria-hidden="true" />
        <div className="workflow-process-lanes">
          <div><span>训练集</span><strong>80%</strong><small>学习处理参数</small></div>
          <div><span>测试集</span><strong>20%</strong><small>仅应用参数</small></div>
        </div>
      </div>
    ),
    deliver: (
      <div className="workflow-visual-deliver">
        <div><Download aria-hidden="true" /><span><strong>processed.csv</strong><small>处理后数据</small></span></div>
        <div><Download aria-hidden="true" /><span><strong>report.html</strong><small>离线质量报告</small></span></div>
        <div><Download aria-hidden="true" /><span><strong>run-record.json</strong><small>规则与参数记录</small></span></div>
      </div>
    ),
  }[stage.id];

  return (
    <div className={`workflow-material workflow-material-${stage.id}`} aria-hidden="true">
      {visual}
      <div className="workflow-visual-result">
        <small>{stage.visualLabel}</small>
        <strong>{stage.visualValue}</strong>
      </div>
    </div>
  );
}

export function LandingWorkflowStory() {
  const [activeIndex, setActiveIndex] = useState(0);
  const lastWheelAt = useRef(0);
  const interactionRef = useRef<HTMLDivElement>(null);
  const lastSectionSnapAt = useRef(0);
  const reduceMotion = useReducedMotion();
  const active = stages[activeIndex];
  const ActiveIcon = active.icon;

  useEffect(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;

    function keepWheelInsideWorkflow(event: globalThis.WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (Math.abs(event.deltaY) < 12) return;

      const now = performance.now();
      if (now - lastWheelAt.current < 420) return;
      lastWheelAt.current = now;
      const direction = event.deltaY > 0 ? 1 : -1;
      setActiveIndex((current) => Math.max(0, Math.min(stages.length - 1, current + direction)));
    }

    function snapBetweenHomeSections(event: globalThis.WheelEvent) {
      if (interaction.contains(event.target as Node) || Math.abs(event.deltaY) < 12) return;
      if (!window.matchMedia("(min-width: 48rem)").matches) return;

      const hero = document.querySelector<HTMLElement>(".home-hero");
      const workflow = document.querySelector<HTMLElement>(".workflow-v3");
      if (!hero || !workflow) return;

      const now = performance.now();
      if (now - lastSectionSnapAt.current < 650) {
        event.preventDefault();
        return;
      }

      const heroRect = hero.getBoundingClientRect();
      const workflowRect = workflow.getBoundingClientRect();
      const movingDownFromHero = event.deltaY > 0
        && heroRect.top <= 1
        && heroRect.bottom > window.innerHeight * 0.2;
      const movingUpFromWorkflow = event.deltaY < 0
        && workflowRect.top < window.innerHeight * 0.65
        && workflowRect.bottom > window.innerHeight * 0.35;

      if (!movingDownFromHero && !movingUpFromWorkflow) return;
      event.preventDefault();
      event.stopPropagation();
      lastSectionSnapAt.current = now;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      (movingDownFromHero ? workflow : hero).scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    }

    interaction.addEventListener("wheel", keepWheelInsideWorkflow, { passive: false });
    document.addEventListener("wheel", snapBetweenHomeSections, { passive: false, capture: true });
    return () => {
      interaction.removeEventListener("wheel", keepWheelInsideWorkflow);
      document.removeEventListener("wheel", snapBetweenHomeSections, { capture: true });
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(stages.length - 1, activeIndex + direction));
    if (nextIndex === activeIndex) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
  }

  return (
    <section
      id="workflow"
      className="workflow-v3"
      aria-labelledby="workflow-title"
    >
      <div
        className="workflow-v3-inner"
      >
        <header className="workflow-v3-header">
          <div>
            <p>一条连续、可解释的处理线</p>
            <h2 id="workflow-title">从发现问题，到交付结果。</h2>
          </div>
        </header>

        <div
          ref={interactionRef}
          className="workflow-v3-stage"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <nav className="workflow-v3-nav" aria-label="产品处理流程">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className={index === activeIndex ? "is-active" : ""}
                aria-current={index === activeIndex ? "step" : undefined}
                onClick={() => setActiveIndex(index)}
              >
                <span>{stage.number}</span>
                <strong>{stage.title}</strong>
              </button>
            ))}
          </nav>

          <div className="workflow-v3-focus" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div
                className="workflow-v3-focus-inner"
                key={active.id}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
                transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="workflow-v3-copy">
                  <span className="workflow-v3-icon"><ActiveIcon aria-hidden="true" /></span>
                  <p className="workflow-v3-number">{active.number} / 05</p>
                  <h3>{active.title}</h3>
                  <p className="workflow-v3-description">{active.description}</p>
                  <dl>
                    <div><dt>当前依据</dt><dd>{active.evidence}</dd></div>
                    <div><dt>阶段结果</dt><dd>{active.outcome}</dd></div>
                  </dl>
                </div>
                <WorkflowMaterial stage={active} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="workflow-v3-assurance">
          <ShieldCheck aria-hidden="true" />
          <strong>全程在本机完成</strong>
          <span>原始文件只读保存，规则与结果可追溯，报告支持离线查看。</span>
        </div>
      </div>
    </section>
  );
}
