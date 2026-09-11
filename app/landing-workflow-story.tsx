"use client";

import { useState, type ComponentType } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Check,
  Download,
  FileSearch,
  Play,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

type Stage = {
  id: string;
  number: string;
  title: string;
  description: string;
  note: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
};

const stages: Stage[] = [
  {
    id: "inspect",
    number: "01",
    title: "先看清数据",
    description: "自动识别缺失值、重复记录、异常类型与类别不一致，不改变任何原始内容。",
    note: "94 个字段已检查",
    icon: FileSearch,
  },
  {
    id: "explain",
    number: "02",
    title: "理解为什么要处理",
    description: "每项建议都带着问题证据、风险、置信度、预计影响和可选方案。",
    note: "1 项建议需要关注",
    icon: SlidersHorizontal,
  },
  {
    id: "confirm",
    number: "03",
    title: "你来做最终决定",
    description: "确认字段角色，选择要执行的规则。系统负责解释，不替你擅自修改。",
    note: "等待确认处理方案",
    icon: Check,
  },
  {
    id: "process",
    number: "04",
    title: "按数据边界执行",
    description: "训练集负责学习处理参数，测试集只应用已学习规则，避免信息泄漏。",
    note: "80% 训练集 · 20% 测试集",
    icon: Play,
  },
  {
    id: "deliver",
    number: "05",
    title: "带着记录交付",
    description: "获取处理后的 CSV、可离线查看的 HTML 报告和完整运行记录。",
    note: "数据、报告与记录已就绪",
    icon: Download,
  },
];

function StoryVisual({ stage }: { stage: Stage }) {
  const isDelivered = stage.id === "deliver";
  const isProcessed = stage.id === "process";
  const isConfirmed = stage.id === "confirm";

  return (
    <div className="story-visual-content">
      <div className="story-visual-head">
        <span>客户流失分析</span>
        <strong>{stage.number} / 05</strong>
      </div>
      {isDelivered ? (
        <div className="story-deliverables">
          <div><span>processed.csv</span><small>处理后数据 · 4.2 MB</small><Download aria-hidden="true" /></div>
          <div><span>report.html</span><small>离线质量报告</small><Download aria-hidden="true" /></div>
          <div><span>run-record.json</span><small>规则与参数记录</small><Download aria-hidden="true" /></div>
        </div>
      ) : (
        <>
          <div className="story-table" aria-hidden="true">
            <div><b>字段</b><b>状态</b><b>处理</b></div>
            <div><span>年龄</span><em>{isProcessed ? "完整" : "18% 空值"}</em><span>{isProcessed ? "已填充" : "待确认"}</span></div>
            <div><span>地区</span><em>{isProcessed ? "已统一" : "2 个异体值"}</em><span>{isProcessed ? "已归一" : "待确认"}</span></div>
            <div><span>客户编号</span><em>唯一</em><span>{isConfirmed ? "设为 ID" : "保留"}</span></div>
          </div>
          <div className="story-recommendation">
            <span>{stage.id === "inspect" ? "检查结果" : stage.id === "explain" ? "建议依据" : stage.id === "confirm" ? "执行权限" : "边界控制"}</span>
            <strong>{stage.description}</strong>
            <small>{stage.note}</small>
          </div>
        </>
      )}
      <div className="story-visual-foot"><ShieldCheck aria-hidden="true" />所有操作仅在本机项目副本中完成</div>
    </div>
  );
}

export function LandingWorkflowStory() {
  const [active, setActive] = useState(stages[0]);
  const reduceMotion = useReducedMotion();

  return (
    <section id="workflow" className="landing-story" aria-labelledby="workflow-title">
      <div className="landing-story-heading">
        <p className="landing-eyebrow">从检查到交付</p>
        <h2 id="workflow-title">一次连续、透明的处理过程</h2>
        <p>向下阅读，看看一份数据如何在你的确认下逐步变得可用。</p>
      </div>

      <div className="landing-story-layout">
        <div className="landing-story-canvas" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={reduceMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <StoryVisual stage={active} />
            </motion.div>
          </AnimatePresence>
        </div>

        <ol className="landing-story-chapters">
          {stages.map((stage) => {
            const Icon = stage.icon;
            const selected = active.id === stage.id;
            return (
              <motion.li
                key={stage.id}
                className={selected ? "is-active" : ""}
                onViewportEnter={() => setActive(stage)}
                viewport={{ amount: 0.62 }}
              >
                <span className="story-chapter-number">{stage.number}</span>
                <Icon aria-hidden="true" />
                <h3>{stage.title}</h3>
                <p>{stage.description}</p>
                <small>{stage.note}</small>
              </motion.li>
            );
          })}
        </ol>
      </div>

      <div className="landing-local-ledger">
        <div>
          <ShieldCheck aria-hidden="true" />
          <p className="landing-eyebrow">本地优先</p>
          <h2>数据不需要离开电脑</h2>
          <p>Better Data 通过本地服务读取项目副本，不上传外部平台，也不会覆盖原始文件。</p>
        </div>
        <dl>
          <div><dt>外部数据传输</dt><dd>关闭</dd></div>
          <div><dt>原始文件</dt><dd>只读保存</dd></div>
          <div><dt>报告查看</dt><dd>支持离线</dd></div>
        </dl>
      </div>
    </section>
  );
}
