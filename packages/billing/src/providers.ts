export type PaymentProviderEnvironment = 'test' | 'live';

export type ExternalReference = {
  providerConnectionId: string;
  resourceType: string;
  externalId: string;
};

export type ProviderOperationResult = {
  provider: string;
  environment: PaymentProviderEnvironment;
  operationId: string;
  externalReference?: ExternalReference;
};

export type CheckoutInput = {
  accountId: string;
  subscriptionId?: string;
  planVersionId: string;
  operationId: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult = ProviderOperationResult & {
  checkoutUrl: string;
};

export type PortalInput = {
  accountId: string;
  operationId: string;
  idempotencyKey: string;
  returnUrl: string;
};

export type PortalResult = ProviderOperationResult & {
  portalUrl: string;
};

export type SubscriptionMutationInput = {
  accountId: string;
  subscriptionId: string;
  operationId: string;
  idempotencyKey: string;
  expectedVersion: number;
};

export type ChangePlanInput = SubscriptionMutationInput & {
  planVersionId: string;
};

export type RefundInput = {
  accountId: string;
  paymentId: string;
  operationId: string;
  idempotencyKey: string;
  amountMinor?: number;
  currency?: string;
};

export type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;

export type VerifiedProviderEvent = {
  provider: string;
  environment: PaymentProviderEnvironment;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  payloadSha256: string;
};

export type NormalizedBillingEvent = {
  eventId: string;
  type:
    | 'checkout_completed'
    | 'payment_succeeded'
    | 'payment_failed'
    | 'subscription_started'
    | 'subscription_changed'
    | 'subscription_canceling'
    | 'subscription_canceled'
    | 'refund_succeeded';
  accountReference?: ExternalReference;
  subscriptionReference?: ExternalReference;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

export type ProviderSubscriptionSnapshot = {
  reference: ExternalReference;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAt?: Date;
  metadata: Record<string, unknown>;
};

export type ReconcileInput = {
  accountId: string;
  subscriptionId?: string;
  operationId: string;
};

export type ReconcileResult = {
  checked: number;
  changed: number;
};

export type UsageReportInput = {
  accountId: string;
  meterKey: string;
  quantity: number;
  occurredAt: Date;
  idempotencyKey: string;
};

export interface PaymentProviderAdapter {
  readonly providerKey: string;
  readonly environment: PaymentProviderEnvironment;

  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortalSession(input: PortalInput): Promise<PortalResult>;
  cancelSubscription(input: SubscriptionMutationInput): Promise<ProviderOperationResult>;
  resumeSubscription(input: SubscriptionMutationInput): Promise<ProviderOperationResult>;
  changePlan(input: ChangePlanInput): Promise<ProviderOperationResult>;
  refund(input: RefundInput): Promise<ProviderOperationResult>;

  verifyWebhook(rawBody: Uint8Array, headers: WebhookHeaders): Promise<VerifiedProviderEvent>;
  normalizeWebhook(event: VerifiedProviderEvent): NormalizedBillingEvent;
  fetchSubscription(reference: ExternalReference): Promise<ProviderSubscriptionSnapshot>;
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
  reportUsage?(input: UsageReportInput): Promise<void>;
}
