import Link from "next/link";
import { Check } from "lucide-react";

export const projectJourney = [
  { key: "create", label: "创建项目", short: "准备" },
  { key: "overview", label: "数据概览", short: "理解" },
  { key: "fields", label: "字段确认", short: "定义" },
  { key: "quality", label: "质量诊断", short: "诊断" },
  { key: "plan", label: "处理方案", short: "决策" },
  { key: "run", label: "执行处理", short: "处理" },
  { key: "results", label: "结果导出", short: "交付" },
] as const;

export type ProjectJourneyStep = (typeof projectJourney)[number]["key"];

export function ProjectJourney({
  current,
  projectId,
}: {
  current: ProjectJourneyStep;
  projectId?: string;
}) {
  const currentIndex = projectJourney.findIndex((item) => item.key === current);
  const currentItem = projectJourney[currentIndex];
  const nextItem = projectJourney[currentIndex + 1];

  return (
    <nav className="project-journey" aria-label="项目完整流程">
      <div className="project-journey-summary">
        <span>项目流程<small>{currentItem.label}{nextItem ? ` → ${nextItem.label}` : " · 已完成"}</small></span>
        <strong>{currentIndex + 1} / {projectJourney.length}</strong>
      </div>
      <ol>
        {projectJourney.map((item, index) => {
          const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          const content = (
            <>
              <span className="project-journey-marker" aria-hidden="true">
                {state === "complete" ? <Check /> : index + 1}
              </span>
              <span className="project-journey-copy">
                <strong>{item.label}</strong>
                <small>{item.short}</small>
              </span>
            </>
          );

          return (
            <li key={item.key} data-state={state}>
              {projectId && item.key !== "create" ? (
                <Link
                  href={`/projects/${projectId}/${item.key}`}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {content}
                </Link>
              ) : (
                <span aria-current={state === "current" ? "step" : undefined}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
