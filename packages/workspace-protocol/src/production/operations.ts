import { z } from 'zod';

const emptyPayloadSchema = z.object({});

export const productionOperationPayloadSchemas = {
  'release.stage': z.object({
    artifactStorageKey: z.string().regex(/^release-[0-9a-f-]+\.zip$/i),
    releaseId: z.string().uuid(),
    sourcePbootVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    sourceCoreCommit: z.string().regex(/^[0-9a-f]{40}$/i),
    firstPublish: z.boolean(),
  }),
  'production.ensure': z.object({
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  }),
  'production.deploy': z.object({
    releaseId: z.string().uuid(),
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    sequence: z.number().int().positive(),
    artifactStorageKey: z.string().regex(/^release-[0-9a-f-]+\.zip$/i),
    artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
    artifactSize: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
    firstPublish: z.boolean(),
  }),
  'production.status': z.object({
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  }),
  'production.authorize': z.object({ authorizationCode: z.string().min(1).max(2048) }),
  'production.destroy': emptyPayloadSchema,
} as const;

export const productionOperationVariants = [
  z.object({
    operation: z.literal('release.stage'),
    payload: productionOperationPayloadSchemas['release.stage'],
  }),
  z.object({
    operation: z.literal('production.ensure'),
    payload: productionOperationPayloadSchemas['production.ensure'],
  }),
  z.object({
    operation: z.literal('production.deploy'),
    payload: productionOperationPayloadSchemas['production.deploy'],
  }),
  z.object({
    operation: z.literal('production.status'),
    payload: productionOperationPayloadSchemas['production.status'],
  }),
  z.object({
    operation: z.literal('production.authorize'),
    payload: productionOperationPayloadSchemas['production.authorize'],
  }),
  z.object({
    operation: z.literal('production.destroy'),
    payload: productionOperationPayloadSchemas['production.destroy'],
  }),
] as const;

export const productionOperationSchema = z.discriminatedUnion(
  'operation',
  productionOperationVariants,
);
export type ProductionOperation = z.infer<typeof productionOperationSchema>;
export type ProductionOperationName = ProductionOperation['operation'];

export const productionOperationResultSchemas = {
  'release.stage': z.object({
    artifactStorageKey: z.string().regex(/^release-[0-9a-f-]+\.zip$/i),
    artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
    artifactSize: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
    manifest: z.record(z.string(), z.unknown()),
  }),
  'production.ensure': z.object({
    websiteId: z.string().uuid(),
    status: z.enum([
      'provisioning',
      'authorization_required',
      'active',
      'failed',
      'stopped',
      'deleting',
    ]),
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    productionPort: z.number().int().positive().max(65_535),
    containerRef: z.string().min(1),
  }),
  'production.deploy': z.object({
    releaseId: z.string().uuid(),
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    sequence: z.number().int().positive(),
    status: z.enum(['authorization_required', 'active']),
    activatedAt: z.string().datetime({ offset: true }),
  }),
  'production.status': z.object({
    websiteId: z.string().uuid(),
    status: z.enum([
      'provisioning',
      'authorization_required',
      'active',
      'failed',
      'stopped',
      'deleting',
      'missing',
    ]),
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    productionPort: z.number().int().positive().max(65_535).nullable(),
    currentReleaseId: z.string().uuid().nullable(),
    authorized: z.boolean(),
  }),
  'production.authorize': z.object({ status: z.literal('active') }),
  'production.destroy': z.null(),
} as const;

export type ProductionOperationResult<K extends ProductionOperationName> = z.infer<
  (typeof productionOperationResultSchemas)[K]
>;

export function isProductionMutationOperation(operation: ProductionOperationName): boolean {
  return operation !== 'production.status';
}
