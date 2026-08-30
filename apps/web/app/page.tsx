export default function Home() {
  return (
    <main className="shell">
      <div className="topline">
        <span className="mark" aria-hidden="true">
          CC
        </span>
        <span>EARLY DEVELOPMENT / MVP FOUNDATION</span>
      </div>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">CloudCrane · 筑云鹤</p>
        <h1 id="page-title">
          Build the web
          <br />
          <em>with a little lift.</em>
        </h1>
        <p className="intro">
          A Website Coding Agent for building and maintaining real websites inside a persistent
          workspace.
        </p>
        <div className="status-card">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Foundation is taking shape</strong>
            <span>CloudCrane is in active MVP development.</span>
          </div>
        </div>
      </section>

      <footer>
        <span>WEBSITE CODING AGENT</span>
        <span>ARCHITECTURE BASELINE · 2026</span>
      </footer>
    </main>
  );
}
