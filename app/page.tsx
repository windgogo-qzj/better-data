import Link from "next/link";
import {
  ArrowRight,
  Check,
  Database,
  FileCheck2,
  ShieldCheck,
  Table2,
  TriangleAlert,
} from "lucide-react";

import { LandingWorkflowStory } from "./landing-workflow-story";

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-header" aria-label="Better Data 产品页页眉">
        <div className="landing-header-inner">
          <div className="landing-brand" aria-label="Better Data">
            <span className="landing-brand-mark"><Database aria-hidden="true" /></span>
            <span><strong>Better Data</strong><small>本地数据预处理工具</small></span>
          </div>
          <span className="landing-header-note"><ShieldCheck aria-hidden="true" />本地处理</span>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">为数据分析人员设计</p>
            <h1 id="landing-title">把原始数据，变成可解释的结果</h1>
            <p className="landing-lead">
              在本机检查表格质量，理解每一项处理建议，确认后再执行。
              原始文件保持不变，过程随时可追溯。
            </p>
            <div className="landing-hero-actions">
              <Link className="landing-primary-link" href="/workspace">
                开始使用 <ArrowRight aria-hidden="true" />
              </Link>
              <a className="landing-text-link" href="#workflow">查看处理流程</a>
            </div>
          </div>

          <div className="landing-data-canvas" aria-label="Better Data 数据检查界面示例">
            <div className="landing-canvas-toolbar">
              <span><Table2 aria-hidden="true" />customer_churn.csv</span>
              <span>本机分析</span>
            </div>
            <div className="landing-canvas-body">
              <div className="landing-sample-sheet" aria-label="样例数据表">
                <div className="landing-sheet-row landing-sheet-head">
                  <span>客户</span><span>年龄</span><span>地区</span><span>月消费</span>
                </div>
                <div className="landing-sheet-row">
                  <span>A-101</span><span className="cell-issue">空值</span><span>华东</span><span>268</span>
                </div>
                <div className="landing-sheet-row">
                  <span>A-102</span><span>31</span><span className="cell-issue">华 東</span><span>311</span>
                </div>
                <div className="landing-sheet-row">
                  <span>A-103</span><span>29</span><span>华南</span><span>291</span>
                </div>
              </div>
              <aside className="landing-evidence">
                <p><TriangleAlert aria-hidden="true" />发现 3 类质量问题</p>
                <strong>年龄字段存在 18% 空值</strong>
                <span>建议：使用训练集中位数填充</span>
                <small>依据 BD-MISSING-01 · 高置信度</small>
              </aside>
            </div>
            <div className="landing-canvas-footer">
              <span><Check aria-hidden="true" />只读检查</span>
              <span>等待你的确认</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-trust-rail" aria-label="产品保障">
        <div><ShieldCheck aria-hidden="true" /><span><strong>数据不离开电脑</strong><small>关闭外部传输</small></span></div>
        <div><FileCheck2 aria-hidden="true" /><span><strong>原始文件保持不变</strong><small>项目副本独立处理</small></span></div>
        <div><Database aria-hidden="true" /><span><strong>每一步都有记录</strong><small>建议、参数与结果可追溯</small></span></div>
      </section>

      <LandingWorkflowStory />

      <footer className="landing-footer">
        <div className="landing-footer-brand"><Database aria-hidden="true" /><strong>Better Data</strong></div>
        <p>本地优先的数据预处理工作台</p>
      </footer>
    </main>
  );
}
