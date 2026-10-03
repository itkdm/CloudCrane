import { z } from 'zod';
import { cmsActionSchemas, cmsOperationResultSchemas } from '@cloudcrane/cms-protocol';

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
  'production.authorize': z.object({
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    authorizationCode: z.string().min(1).max(2048),
  }),
  'production.destroy': z.object({
    releaseIds: z.array(z.string().uuid()).max(10_000).default([]),
  }),
  'production.refresh': z.object({
    productionSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    refreshId: z.string().uuid(),
  }),
  'cms.categories.list': cmsActionSchemas['cms.categories.list'],
  'cms.content.list': cmsActionSchemas['cms.content.list'],
  'cms.content.get': cmsActionSchemas['cms.content.get'],
  'cms.content.update': cmsActionSchemas['cms.content.update'],
  'cms.company.get': cmsActionSchemas['cms.company.get'],
  'cms.company.update': cmsActionSchemas['cms.company.update'],
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
  z.object({
    operation: z.literal('production.refresh'),
    payload: productionOperationPayloadSchemas['production.refresh'],
  }),
  ...(
    [
      'cms.categories.list',
      'cms.content.list',
      'cms.content.get',
      'cms.content.update',
      'cms.company.get',
      'cms.company.update',
    ] as const
  ).map((operation) =>
    z.object({
      operation: z.literal(operation),
      payload: productionOperationPayloadSchemas[operation],
    }),
  ),
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
      'activating',
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
      'activating',
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
  'production.refresh': z.object({
    databaseBytes: z.number().int().positive(),
    uploadFiles: z.number().int().nonnegative(),
    uploadBytes: z.number().int().nonnegative(),
  }),
  'cms.categories.list': cmsOperationResultSchemas['cms.categories.list'],
  'cms.content.list': cmsOperationResultSchemas['cms.content.list'],
  'cms.content.get': cmsOperationResultSchemas['cms.content.get'],
  'cms.content.update': cmsOperationResultSchemas['cms.content.update'],
  'cms.company.get': cmsOperationResultSchemas['cms.company.get'],
  'cms.company.update': cmsOperationResultSchemas['cms.company.update'],
} as const;

export type ProductionOperationResult<K extends ProductionOperationName> = z.infer<
  (typeof productionOperationResultSchemas)[K]
>;

export function isProductionMutationOperation(operation: ProductionOperationName): boolean {
  return (
    operation !== 'production.status' &&
    operation !== 'cms.categories.list' &&
    operation !== 'cms.content.list' &&
    operation !== 'cms.content.get' &&
    operation !== 'cms.company.get'
  );
}
