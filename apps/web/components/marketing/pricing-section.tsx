'use client';

import { Box, Check, Crown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '../../i18n/navigation';

export function PricingSection() {
  const t = useTranslations('marketing');
  const [annual, setAnnual] = useState(false);
  const plans = [
    {
      name: t('pricingFreePlan'),
      description: t('pricingFreeDescription'),
      monthly: '$0',
      annual: '$0',
      Icon: Box,
      action: t('pricingFreeAction'),
      href: '/app/websites',
      features: [
        { label: t('pricingFreeFeature1'), included: true },
        { label: t('pricingFreeFeature2'), included: true },
        { label: t('pricingFreeFeature3'), included: true },
        { label: t('pricingFreeFeature4'), included: true },
        { label: t('pricingFreeFeature5'), included: true },
        { label: t('pricingFreeFeature6'), included: true },
        { label: t('pricingFreeFeature7'), included: false },
        { label: t('pricingFreeFeature8'), included: false },
        { label: t('pricingFreeFeature9'), included: false },
      ],
    },
    {
      name: t('pricingStarter'),
      description: t('pricingStarterDescription'),
      monthly: '$7.99',
      annual: '$79.99',
      Icon: Box,
      action: t('pricingStarterAction'),
      href: '/app/websites',
      features: [
        { label: t('pricingStarterFeature1'), included: true },
        { label: t('pricingStarterFeature2'), included: true },
        { label: t('pricingStarterFeature3'), included: true },
        { label: t('pricingStarterFeature4'), included: true },
        { label: t('pricingStarterFeature5'), included: true },
        { label: t('pricingStarterFeature6'), included: true },
        { label: t('pricingStarterFeature7'), included: true },
        { label: t('pricingStarterFeature8'), included: true },
      ],
    },
    {
      name: t('pricingPro'),
      description: t('pricingProDescription'),
      monthly: '$29.99',
      annual: '$299.99',
      Icon: Crown,
      action: t('pricingProAction'),
      href: '/app/websites',
      features: [
        { label: t('pricingProFeature1'), included: true },
        { label: t('pricingProFeature2'), included: true },
        { label: t('pricingProFeature3'), included: true },
        { label: t('pricingProFeature4'), included: true },
        { label: t('pricingProFeature5'), included: true },
      ],
      featured: true,
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
      </div>
      <div className="pricing-toolbar">
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
              <span className="pricing-card-icon" aria-hidden="true">
                <plan.Icon size={19} strokeWidth={1.8} />
              </span>
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
            </div>
            <div className="pricing-card-price">
              <strong>{annual ? plan.annual : plan.monthly}</strong>
              {plan.monthly !== '$0' ? (
                <span>{annual ? t('pricingPerYear') : t('pricingPerMonth')}</span>
              ) : null}
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li
                  className={feature.included ? '' : 'pricing-feature-disabled'}
                  key={feature.label}
                >
                  {feature.included ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <X size={16} aria-hidden="true" />
                  )}
                  <span>{feature.label}</span>
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
