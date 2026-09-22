'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '../../i18n/navigation';

export function PricingSection() {
  const t = useTranslations('marketing');
  const [annual, setAnnual] = useState(false);
  const plans = [
    {
      name: t('pricingStarter'),
      description: t('pricingStarterDescription'),
      monthly: '0',
      annual: '0',
      unit: t('pricingFree'),
      action: t('pricingStarterAction'),
      href: '/app/websites',
      features: [
        t('pricingStarterFeature1'),
        t('pricingStarterFeature2'),
        t('pricingStarterFeature3'),
      ],
    },
    {
      name: t('pricingPro'),
      description: t('pricingProDescription'),
      monthly: '49',
      annual: '39',
      unit: t('pricingPerMonth'),
      action: t('pricingProAction'),
      href: 'mailto:hello@itkdm.com',
      featured: true,
      features: [t('pricingProFeature1'), t('pricingProFeature2'), t('pricingProFeature3')],
    },
    {
      name: t('pricingTeam'),
      description: t('pricingTeamDescription'),
      monthly: '129',
      annual: '99',
      unit: t('pricingPerMonth'),
      action: t('pricingTeamAction'),
      href: 'mailto:hello@itkdm.com',
      features: [t('pricingTeamFeature1'), t('pricingTeamFeature2'), t('pricingTeamFeature3')],
    },
  ];

  return (
    <section
      className="marketing-section marketing-pricing"
      id="pricing"
      aria-labelledby="pricing-title"
    >
      <div className="marketing-section-heading pricing-section-heading">
        <p className="marketing-eyebrow">{t('pricingLabel')}</p>
        <h2 id="pricing-title">{t('pricingTitle')}</h2>
        <p>{t('pricingDescription')}</p>
        <span className="pricing-demo-note">{t('pricingDemoNote')}</span>
      </div>
      <div className="pricing-toolbar" aria-label={t('pricingBillingLabel')}>
        <span>{t('pricingBillingLabel')}</span>
        <div className="pricing-toggle" role="group" aria-label={t('pricingBillingLabel')}>
          <button
            type="button"
            className={!annual ? 'active' : ''}
            onClick={() => setAnnual(false)}
          >
            {t('pricingMonthly')}
          </button>
          <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>
            {t('pricingAnnual')}
            <em>{t('pricingAnnualDiscount')}</em>
          </button>
        </div>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article
            className={`pricing-card ${plan.featured ? 'pricing-card-featured' : ''}`}
            key={plan.name}
          >
            {plan.featured ? (
              <span className="pricing-card-badge">{t('pricingRecommended')}</span>
            ) : null}
            <div className="pricing-card-header">
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
            </div>
            <div className="pricing-card-price">
              <strong>
                {plan.monthly === '0' ? plan.unit : `$${annual ? plan.annual : plan.monthly}`}
              </strong>
              {plan.monthly !== '0' ? <span>{plan.unit}</span> : null}
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={16} aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link
              className={`marketing-button ${plan.featured ? 'marketing-button-primary' : 'marketing-button-secondary'}`}
              href={plan.href}
            >
              {plan.action}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
