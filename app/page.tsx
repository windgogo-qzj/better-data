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
            <p className="landing-eyebrow">本地数据预处理 · 有依据地执行</p>
            <h1 id="landing-title">先看清问题，<br />再处理数据。</h1>
            <p className="landing-lead">
              Better Data 在本机检查表格，把问题、依据和影响放在同一个界面里。
              你确认规则，它负责执行并留下完整记录。
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
              <span>只读检查 · 本机</span>
            </div>
            <div className="landing-canvas-body">
              <div className="landing-sheet-panel">
                <div className="landing-sheet-summary"><span>原始数据</span><strong>973 行 · 94 列</strong></div>
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
              </div>
              <aside className="landing-evidence">
                <p><TriangleAlert aria-hidden="true" />质量诊断</p>
                <strong>发现 3 类问题</strong>
                <dl>
                  <div><dt>年龄</dt><dd>18% 空值</dd></div>
                  <div><dt>地区</dt><dd>2 个异体值</dd></div>
                  <div><dt>客户编号</dt><dd>12 条重复</dd></div>
                </dl>
                <span>建议使用训练集中位数填充年龄</span>
                <small>BD-MISSING-01 · 高置信度</small>
              </aside>
            </div>
            <div className="landing-canvas-footer">
              <span><Check aria-hidden="true" />检查完成</span>
              <span>下一步：确认字段角色</span>
            </div>
          </div>

          <div className="landing-trust-rail" aria-label="产品保障">
            <div><ShieldCheck aria-hidden="true" /><span><strong>本地运行</strong><small>数据不离开电脑</small></span></div>
            <div><FileCheck2 aria-hidden="true" /><span><strong>原件只读</strong><small>项目副本独立处理</small></span></div>
            <div><Database aria-hidden="true" /><span><strong>全程留痕</strong><small>规则与结果可追溯</small></span></div>
          </div>
        </div>
      </section>

      <LandingWorkflowStory />

      <footer className="landing-footer">
        <div className="landing-footer-brand"><Database aria-hidden="true" /><strong>Better Data</strong></div>
        <p>本地优先的数据预处理工作台</p>
      </footer>
    </main>
  );
}
