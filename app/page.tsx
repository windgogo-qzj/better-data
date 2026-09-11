import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Database, LockKeyhole } from "lucide-react";

import { LandingWorkflowStory } from "./landing-workflow-story";

export default function LandingPage() {
  return (
    <main className="home-v3">
      <section className="home-hero" aria-labelledby="home-title">
        <Image
          className="home-hero-image"
          src="/images/data-analyst-overwhelmed-v1.png"
          alt="一位数据分析人员面对混乱的表格记录，正在梳理数据问题"
          fill
          priority
          sizes="100vw"
        />
        <div className="home-hero-shade" aria-hidden="true" />
        <div className="home-hero-grain" aria-hidden="true" />

        <div className="home-hero-content">
          <div className="home-brand" aria-label="Better Data 本地数据预处理工作台">
            <span className="home-brand-mark"><Database aria-hidden="true" /></span>
            <span><strong>Better Data</strong><small>本地数据预处理工作台</small></span>
          </div>

          <div className="home-hero-copy">
            <p className="home-hero-context">数据问题应该被看清，而不是被猜测。</p>
            <h1 id="home-title">把混乱的数据，<br />整理成可信的结果。</h1>
            <p className="home-hero-lead">
              在本机完成检查、解释、确认与处理。每条建议有依据，每次执行有记录，原始文件始终保留。
            </p>
            <div className="home-hero-actions">
              <Link className="home-primary-action" href="/workspace">
                开始整理数据 <ArrowRight aria-hidden="true" />
              </Link>
              <a className="home-secondary-action" href="#workflow">了解处理流程</a>
            </div>
            <p className="home-local-note"><LockKeyhole aria-hidden="true" />不上传数据，仅处理本机项目副本</p>
          </div>
        </div>
      </section>

      <LandingWorkflowStory />

      <footer className="home-footer">
        <span><Database aria-hidden="true" /><strong>Better Data</strong></span>
        <p>让每一次数据处理都有依据。</p>
      </footer>
    </main>
  );
}
