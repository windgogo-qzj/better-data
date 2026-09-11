"use client";

import { useParams } from "next/navigation";

import ProjectAnalysisPage from "../page";

export default function ProjectWorkflowStepPage() {
  const params = useParams<{ step: string }>();
  const step = Array.isArray(params.step) ? params.step[0] : params.step;

  return <ProjectAnalysisPage requestedStep={step} />;
}
