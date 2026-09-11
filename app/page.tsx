import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileText,
  GitBranch,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  TriangleAlert,
} from "lucide-react";

const capabilities = [
  {
    icon: Search,
    title: "自动发现数据问题",
    description: "检查缺失值、重复记录、字段类型与潜在质量风险。",
    visual: (
      <div className="landing-mini-table" aria-hidden="true">
        <span>字段</span><span>完整率</span>
        <strong>收入</strong><em>82%</em>
        <strong>地区</strong><em>96%</em>
      </div>
    ),
  },
  {
    icon: Sparkles,
    title: "建议有依据",
    description: "展示问题证据、风险、置信度、预计影响和替代方案。",
    visual: (
      <div className="landing-rule-sample" aria-hidden="true">
        <span>规则 BD-MISSING-01</span>
        <strong>建议使用中位数填充</strong>
        <small>低风险 · 高置信度</small>
      </div>
    ),
  },
  {
    icon: GitBranch,
    title: "严格控制数据边界",
    description: "分类和回归只在训练集学习处理参数，再转换测试集。",
    visual: (
      <div className="landing-split-sample" aria-hidden="true">
        <span><b>80%</b> 训练集拟合</span>
        <span><b>20%</b> 测试集转换</span>
      </div>
    ),
  },
  {
    icon: Download,
    title: "结果可以直接使用",
    description: "导出处理后的 CSV、运行记录和可离线查看的 HTML 报告。",
    visual: (
      <div className="landing-export-sample" aria-hidden="true">
        <span>CSV</span><span>HTML</span><span>记录</span>
      </div>
    ),
  },
] as const;

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-header" aria-label="Better Data 产品页页眉">
        <div className="landing-header-inner">
          <div className="landing-brand" aria-label="Better Data">
            <span className="landing-brand-mark"><Database aria-hidden="true" /></span>
            <span><strong>Better Data</strong><small>本地数据预处理工具</small></span>
          </div>
          <span className="landing-version">MVP v0.1.0</span>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-grid-pattern" aria-hidden="true" />
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">为数据分析人员设计</p>
            <h1 id="landing-title">让数据预处理变得<br />简单、可靠、可复现</h1>
            <p className="landing-lead">
              Better Data 在你的电脑上检查表格质量、解释处理建议，并帮助你完成字段确认、
              数据清洗、基础特征处理、快速评估和结果导出。
            </p>
            <Link className="landing-primary-link" href="/workspace">
              开始使用 <ArrowRight aria-hidden="true" />
            </Link>
            <ul className="landing-trust-list" aria-label="产品保障">
              <li><CheckCircle2 aria-hidden="true" />数据仅在本机处理</li>
              <li><CheckCircle2 aria-hidden="true" />原始文件不会被修改</li>
              <li><CheckCircle2 aria-hidden="true" />每项建议都有依据</li>
            </ul>
          </div>

          <div className="landing-data-visual" aria-label="原始表格经过 Better Data 处理后变为可用数据的流程示意">
            <div className="landing-visual-caption"><span>处理流程示意</span><b>LOCAL</b></div>
            <div className="landing-source-card">
              <div className="landing-card-heading">
                <span><Table2 aria-hidden="true" />原始表格</span>
                <small>发现 3 类问题</small>
              </div>
              <div className="landing-table-preview" aria-hidden="true">
                <span className="landing-cell landing-cell-header">客户</span>
                <span className="landing-cell landing-cell-header">年龄</span>
                <span className="landing-cell landing-cell-header">地区</span>
                <span className="landing-cell">A-101</span>
                <span className="landing-cell landing-cell-warning">空值</span>
                <span className="landing-cell">华东</span>
                <span className="landing-cell">A-102</span>
                <span className="landing-cell">31</span>
                <span className="landing-cell landing-cell-error">华 東</span>
              </div>
              <div className="landing-issue-row">
                <span><TriangleAlert aria-hidden="true" />缺失值</span>
                <span>类别不一致</span>
                <span>重复记录</span>
              </div>
            </div>

            <div className="landing-pipeline" aria-hidden="true">
              <span>检查</span><i />
              <span>建议</span><i />
              <span>确认</span><i />
              <span>处理</span>
            </div>

            <div className="landing-result-card">
              <div className="landing-card-heading">
                <span><CheckCircle2 aria-hidden="true" />可用数据</span>
                <small>结构已统一</small>
              </div>
              <div className="landing-result-body">
                <div className="landing-quality-score"><strong>92</strong><span>质量评分</span></div>
                <div className="landing-result-files">
                  <span><Table2 aria-hidden="true" />处理后数据</span>
                  <span><FileText aria-hidden="true" />离线报告</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-capabilities" aria-labelledby="capabilities-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">从检查到交付</p>
          <h2 id="capabilities-title">一套完整、可解释的处理流程</h2>
          <p>系统给出建议，你保留最终决定权。每次运行都有边界、有记录，也可以重新执行。</p>
        </div>
        <div className="landing-capability-grid">
          {capabilities.map(({ icon: Icon, title, description, visual }, index) => (
            <article className={`landing-capability-card landing-capability-${index + 1}`} key={title}>
              <span className="landing-capability-icon"><Icon aria-hidden="true" /></span>
              <div><h3>{title}</h3><p>{description}</p></div>
              {visual}
            </article>
          ))}
        </div>
      </section>

      <section className="landing-local-section" aria-labelledby="local-title">
        <div className="landing-local-pattern" aria-hidden="true" />
        <div className="landing-local-copy">
          <span className="landing-local-icon"><ShieldCheck aria-hidden="true" /></span>
          <p className="landing-eyebrow">本地优先</p>
          <h2 id="local-title">你的数据不会离开电脑</h2>
          <p>Better Data 通过本地服务读取和处理文件，不上传外部平台，也不会覆盖你的原始数据。</p>
        </div>
        <dl className="landing-local-facts">
          <div><dt>外部数据传输</dt><dd>关闭</dd></div>
          <div><dt>原始文件</dt><dd>只读保存</dd></div>
          <div><dt>报告查看</dt><dd>支持离线</dd></div>
        </dl>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-brand"><Database aria-hidden="true" /><strong>Better Data</strong></div>
        <p>本地数据预处理工作台 · 中文界面 · MVP v0.1.0</p>
      </footer>
    </main>
  );
}
