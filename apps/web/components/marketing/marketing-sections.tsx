import { useTranslations } from 'next-intl';

export function MarketingSections() {
  const t = useTranslations('marketing');
  const steps = [
    ['stepConnect', 'stepConnectDescription'],
    ['stepDescribe', 'stepDescribeDescription'],
    ['stepVerify', 'stepVerifyDescription'],
  ] as const;
  const capabilities = [
    ['capabilityWorkspace', 'capabilityWorkspaceDescription'],
    ['capabilityBrowser', 'capabilityBrowserDescription'],
    ['capabilityMaintenance', 'capabilityMaintenanceDescription'],
  ] as const;
  const plans = [
    ['pricingStarter', 'pricingStarterDescription', 'pricingStarterAction'],
    ['pricingPro', 'pricingProDescription', 'pricingProAction'],
    ['pricingTeam', 'pricingTeamDescription', 'pricingTeamAction'],
  ] as const;
  return (
    <>
      <section className="marketing-section" id="workflow" aria-labelledby="workflow-title">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">{t('workflowLabel')}</p>
          <h2 id="workflow-title">{t('workflowTitle')}</h2>
        </div>
        <ol className="workflow-grid">
          {steps.map(([title, description], index) => (
            <li key={title}>
              <span className="workflow-step">{index + 1}</span>
              <h3>{t(title)}</h3>
              <p>{t(description)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="marketing-section marketing-capabilities"
        id="capability"
        aria-labelledby="capability-title"
      >
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">{t('capabilityLabel')}</p>
          <h2 id="capability-title">{t('capabilityTitle')}</h2>
        </div>
        <div className="capability-grid">
          {capabilities.map(([title, description]) => (
            <article key={title}>
              <h3>{t(title)}</h3>
              <p>{t(description)}</p>
            </article>
          ))}
        </div>
      </section>
      <section
        className="marketing-section marketing-pricing"
        id="pricing"
        aria-labelledby="pricing-title"
      >
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">{t('pricingLabel')}</p>
          <h2 id="pricing-title">{t('pricingTitle')}</h2>
          <p>{t('pricingDescription')}</p>
        </div>
        <div className="pricing-grid">
          {plans.map(([title, description, action], index) => (
            <article
              className={`pricing-card ${index === 1 ? 'pricing-card-featured' : ''}`}
              key={title}
            >
              {index === 1 ? (
                <span className="pricing-card-badge">{t('pricingRecommended')}</span>
              ) : null}
              <h3>{t(title)}</h3>
              <p>{t(description)}</p>
              <strong>{t(index === 0 ? 'pricingStarterPrice' : 'pricingContactPrice')}</strong>
              <a
                className="marketing-button marketing-button-secondary"
                href={index === 0 ? '/app/websites' : 'mailto:hello@itkdm.com'}
              >
                {t(action)}
              </a>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
