import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  Eye,
  FileText,
  Link2,
  PanelsTopLeft,
  RefreshCw,
} from 'lucide-react';
import { PricingSection } from './pricing-section';

export function MarketingSections() {
  const t = useTranslations('marketing');
  const steps = [
    ['stepConnect', 'stepConnectDescription', Link2],
    ['stepDescribe', 'stepDescribeDescription', FileText],
    ['stepVerify', 'stepVerifyDescription', CircleCheck],
  ] as const;
  const capabilities = [
    [
      'capabilityWorkspace',
      'capabilityWorkspaceDescription',
      'capabilityWorkspaceTag',
      PanelsTopLeft,
    ],
    ['capabilityBrowser', 'capabilityBrowserDescription', 'capabilityBrowserTag', Eye],
    [
      'capabilityMaintenance',
      'capabilityMaintenanceDescription',
      'capabilityMaintenanceTag',
      RefreshCw,
    ],
  ] as const;
  return (
    <>
      <section className="marketing-section" id="workflow" aria-labelledby="workflow-title">
        <div className="marketing-section-heading marketing-section-heading-centered">
          <p className="marketing-eyebrow">{t('workflowLabel')}</p>
          <h2 id="workflow-title">{t('workflowTitle')}</h2>
          <p>{t('workflowDescription')}</p>
        </div>
        <ol className="workflow-grid">
          {steps.map(([title, description, Icon], index) => (
            <li key={title}>
              <div className="workflow-node">
                <span className="workflow-icon" aria-hidden="true">
                  <Icon size={23} strokeWidth={1.8} />
                </span>
                <span className="workflow-step">0{index + 1}</span>
              </div>
              <h3>{t(title)}</h3>
              <p>{t(description)}</p>
              {index < steps.length - 1 ? (
                <ArrowRight
                  className="workflow-connector"
                  size={44}
                  strokeWidth={1.4}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <section
        className="marketing-section marketing-capabilities"
        id="capability"
        aria-labelledby="capability-title"
      >
        <div className="marketing-section-heading marketing-section-heading-centered">
          <p className="marketing-eyebrow">{t('capabilityLabel')}</p>
          <h2 id="capability-title">{t('capabilityTitle')}</h2>
          <p>{t('capabilityDescription')}</p>
        </div>
        <div className="capability-grid">
          {capabilities.map(([title, description, tag, Icon], index) => (
            <article
              className={
                index === 0 ? 'capability-card capability-card-featured' : 'capability-card'
              }
              key={title}
            >
              <div className="capability-card-topline">
                <span className="capability-icon" aria-hidden="true">
                  <Icon size={19} strokeWidth={1.8} />
                </span>
                <span className="capability-index">0{index + 1}</span>
              </div>
              <span className="capability-tag">{t(tag)}</span>
              <h3>{t(title)}</h3>
              <p>{t(description)}</p>
              <a className="capability-card-link" href="#pricing">
                {t('capabilityLearnMore')}
                <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      </section>
      <PricingSection />
    </>
  );
}
