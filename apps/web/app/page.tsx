import Link from 'next/link';

export default function Home() {
  return (
    <main className="shell">
      <div className="topline">
        <span className="mark" aria-hidden="true">
          CC
        </span>
        <span>AI 网站助手</span>
      </div>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">CloudCrane · 筑云鹤</p>
        <h1 id="page-title">
          让 AI 直接
          <br />
          <em>修改真实网站</em>
        </h1>
        <p className="intro">
          连接网站后，只要描述你想改什么，Agent 就会读取代码、修改网站，并检查实际页面。
        </p>
        <Link className="status-card" href="/websites">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>进入我的网站</strong>
            <span>创建并管理你正在建设的网站。</span>
          </div>
        </Link>
      </section>

      <footer>
        <span>CloudCrane · 筑云鹤</span>
        <span>让网站持续变好</span>
      </footer>
    </main>
  );
}
