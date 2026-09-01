import Link from 'next/link';
import './landing.css';

const PROOF = [
  { value: '长期', label: '独立工作区' },
  { value: '真实', label: '浏览器验收' },
  { value: '持续', label: '维护与迭代' },
];

const WORKFLOW_STEPS = [
  {
    index: '01',
    title: '连接网站',
    description: '创建网站并完成授权，系统会为它准备一个长期存在的独立工作区。',
  },
  {
    index: '02',
    title: '说出需求',
    description: '用中文描述想改什么，Agent 读取真实代码，在工作区里完成修改。',
  },
  {
    index: '03',
    title: '验收上线',
    description: '在真实浏览器中查看改动后的页面效果，确认无误后再决定如何落地。',
  },
];

const CAPABILITIES = [
  {
    title: '长期工作区',
    description: '每个网站拥有持久独立的 Workspace，代码与上下文不会随会话结束而消失。',
  },
  {
    title: '真实浏览器验收',
    description: '改动在真实页面环境中被检查，而不只是生成一段看起来正确的代码。',
  },
  {
    title: '持续维护',
    description: 'Agent 可以反复参与同一个网站的开发、修改、验证和长期迭代。',
  },
  {
    title: 'PbootCMS 支持',
    description: '内置 PbootCMS 模板与授权流程，连接现有站点后即可开始协作。',
  },
];

export default function Home() {
  return (
    <main className="landing">
      <header className="ld-nav ld-reveal ld-d1">
        <Link className="ld-brand" href="/">
          <span className="ld-brand-cn">筑云鹤</span>
          <span className="ld-brand-en">CloudCrane</span>
        </Link>
        <nav className="ld-nav-links" aria-label="主导航">
          <Link className="ld-nav-link" href="#workflow">
            工作流
          </Link>
          <Link className="ld-nav-link" href="#capability">
            能力
          </Link>
          <Link className="ld-btn ld-btn-primary ld-btn-sm" href="/websites">
            我的网站
          </Link>
        </nav>
      </header>

      <section className="ld-hero" aria-labelledby="page-title">
        <div>
          <p className="ld-tag ld-reveal ld-d2">
            <span className="ld-tag-dot" aria-hidden="true" />
            AI 网站工程师
            <span className="ld-tag-en">Website Coding Agent</span>
          </p>
          <h1 className="ld-title ld-reveal ld-d3" id="page-title">
            让 AI 直接
            <br />
            <em>改好你的网站</em>
          </h1>
          <p className="ld-lede ld-reveal ld-d4">
            连接你的网站，用中文说出想改什么。筑云鹤会在独立工作区里读代码、做修改，并在真实浏览器中验证效果——
            <strong>不是给你一段代码，而是真的改好</strong>。
          </p>
          <div className="ld-actions ld-reveal ld-d5">
            <Link className="ld-btn ld-btn-primary" href="/websites">
              进入我的网站
            </Link>
            <Link className="ld-btn ld-btn-ghost" href="#workflow">
              看看它怎么做到的
            </Link>
          </div>
          <div className="ld-proof ld-reveal ld-d6">
            {PROOF.map((item) => (
              <div className="ld-proof-item" key={item.label}>
                <span className="ld-proof-value">{item.value}</span>
                <span className="ld-proof-label">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ld-stage ld-reveal ld-d4" aria-hidden="true">
          <div className="ld-window">
            <div className="ld-window-bar">
              <span className="ld-dot" />
              <span className="ld-dot" />
              <span className="ld-dot" />
              <span className="ld-url">preview.cloudcrane.dev</span>
            </div>
            <div className="ld-window-body">
              <div className="ld-sk ld-sk-title" />
              <div className="ld-sk" />
              <div className="ld-sk ld-sk-short" />
              <div className="ld-sk ld-sk-accent" />
              <div className="ld-sk ld-sk-short" />
            </div>
          </div>
          <div className="ld-code">
            <div className="ld-code-line">
              <span className="ld-code-num">01</span>
              <span>读取 index.html</span>
            </div>
            <div className="ld-code-line">
              <span className="ld-code-num">02</span>
              <span className="ld-code-hl">修改 导航栏配色</span>
            </div>
            <div className="ld-code-line">
              <span className="ld-code-num">03</span>
              <span>启动 预览浏览器</span>
            </div>
            <div className="ld-code-line">
              <span className="ld-code-num">04</span>
              <span className="ld-code-hl">真实页面验收通过</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ld-section" id="workflow" aria-labelledby="workflow-title">
        <div className="ld-section-head">
          <span className="ld-section-index">01 / 工作流</span>
          <h2 className="ld-section-title" id="workflow-title">
            三步之后，网站就改好了
          </h2>
        </div>
        <ol className="ld-steps">
          {WORKFLOW_STEPS.map((step) => (
            <li className="ld-step" key={step.index}>
              <span className="ld-step-num">{step.index}</span>
              <h3 className="ld-step-title">{step.title}</h3>
              <p className="ld-step-desc">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ld-section" id="capability" aria-labelledby="capability-title">
        <div className="ld-section-head">
          <span className="ld-section-index">02 / 能力</span>
          <h2 className="ld-section-title" id="capability-title">
            为长期维护一个网站而设计
          </h2>
        </div>
        <div className="ld-caps">
          {CAPABILITIES.map((item) => (
            <article className="ld-cap" key={item.title}>
              <h3 className="ld-cap-title">{item.title}</h3>
              <p className="ld-cap-desc">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="ld-footer">
        <span>筑云鹤 CloudCrane</span>
        <span>让网站持续变好</span>
      </footer>
    </main>
  );
}
