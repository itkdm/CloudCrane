import { useTranslations } from 'next-intl';
import { Link } from '../../../i18n/navigation';
import '../../landing.css';

export default function Home() {
  const t = useTranslations('marketing');
  const proof = [
    ['01', t('proofWorkspace')],
    ['02', t('proofBrowser')],
    ['03', t('proofMaintenance')],
  ];
  const workflow = [
    ['01', t('stepConnect'), t('stepConnectDescription')],
    ['02', t('stepDescribe'), t('stepDescribeDescription')],
    ['03', t('stepVerify'), t('stepVerifyDescription')],
  ];
  const capabilities = [
    ['capabilityWorkspace', 'capabilityWorkspaceDescription'],
    ['capabilityBrowser', 'capabilityBrowserDescription'],
    ['capabilityMaintenance', 'capabilityMaintenanceDescription'],
    ['capabilityPboot', 'capabilityPbootDescription'],
  ];
  return (
    <main className="landing">
      <header className="ld-nav ld-reveal ld-d1">
        <Link className="ld-brand" href="/">
          <span className="ld-brand-cn">筑云鹤</span>
          <span className="ld-brand-en">CloudCrane</span>
        </Link>
        <nav className="ld-nav-links" aria-label={t('workflowLabel')}>
          <Link className="ld-nav-link" href="#workflow">
            {t('workflowLabel')}
          </Link>
          <Link className="ld-nav-link" href="#capability">
            {t('capabilityLabel')}
          </Link>
          <Link className="ld-btn ld-btn-primary ld-btn-sm" href="/app/websites">
            {t('cta')}
          </Link>
        </nav>
      </header>

      <section className="ld-hero" aria-labelledby="page-title">
        <div>
          <p className="ld-tag ld-reveal ld-d2">
            <span className="ld-tag-dot" aria-hidden="true" />
            {t('eyebrow')}
            <span className="ld-tag-en">{t('tagline')}</span>
          </p>
          <h1 className="ld-title ld-reveal ld-d3" id="page-title">
            {t('title')}
          </h1>
          <p className="ld-lede ld-reveal ld-d4">{t('lede')}</p>
          <div className="ld-actions ld-reveal ld-d5">
            <Link className="ld-btn ld-btn-primary" href="/app/websites">
              {t('cta')}
            </Link>
            <Link className="ld-btn ld-btn-ghost" href="#workflow">
              {t('workflowLink')}
            </Link>
          </div>
          <div className="ld-proof ld-reveal ld-d6">
            {proof.map(([value, label]) => (
              <div className="ld-proof-item" key={label}>
                <span className="ld-proof-value">{value}</span>
                <span className="ld-proof-label">{label}</span>
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
          <span className="ld-section-index">{t('workflowLabel')}</span>
          <h2 className="ld-section-title" id="workflow-title">
            {t('workflowTitle')}
          </h2>
        </div>
        <ol className="ld-steps">
          {workflow.map(([index, title, description]) => (
            <li className="ld-step" key={index}>
              <span className="ld-step-num">{index}</span>
              <h3 className="ld-step-title">{title}</h3>
              <p className="ld-step-desc">{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ld-section" id="capability" aria-labelledby="capability-title">
        <div className="ld-section-head">
          <span className="ld-section-index">{t('capabilityLabel')}</span>
          <h2 className="ld-section-title" id="capability-title">
            {t('capabilityTitle')}
          </h2>
        </div>
        <div className="ld-caps">
          {capabilities.map(([title, description]) => (
            <article className="ld-cap" key={title}>
              <h3 className="ld-cap-title">{t(title as never)}</h3>
              <p className="ld-cap-desc">{t(description as never)}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="ld-footer">
        <span>筑云鹤 CloudCrane</span>
        <span>{t('footer')}</span>
      </footer>
    </main>
  );
}
