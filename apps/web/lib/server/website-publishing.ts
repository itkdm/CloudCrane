import { and, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  agentRun,
  entitlementDefinition,
  entitlementGrant,
  productionRuntime,
  productionDomain,
  operation,
  website,
  websiteRelease,
  workspace,
} from '@cloudcrane/db';
import { BILLING_FEATURES } from '@cloudcrane/billing';
import { normalizeProductionSlug } from '@cloudcrane/shared';
import {
  ProductionClient,
  ProductionClientError,
  WorkspaceClient,
  WorkspaceClientError,
} from '@cloudcrane/workspace-client';
import {
  decideProductionAdmission,
  mapProductionEntitlementGrants,
} from './production-publish-entitlement.js';

type PublishErrorCode =
  | 'WEBSITE_NOT_READY'
  | 'WEBSITE_BUSY'
  | 'PRODUCTION_NOT_ENTITLED'
  | 'PRODUCTION_QUOTA_EXCEEDED'
  | 'ENTITLEMENT_UNAVAILABLE'
  | 'PUBLISH_ALREADY_RUNNING'
  | 'PRODUCTION_INGRESS_NOT_CONFIGURED'
  | 'RELEASE_PREFLIGHT_FAILED'
  | 'WORKSPACE_CHANGED_DURING_PUBLISH'
  | 'RELEASE_STAGE_FAILED'
  | 'PRODUCTION_RUNTIME_FAILED'
  | 'RELEASE_ACTIVATION_FAILED'
  | 'PRODUCTION_SLUG_TAKEN'
  | 'UNKNOWN_RESULT';

export class WebsitePublishError extends Error {
  constructor(
    public readonly code: PublishErrorCode,
    message: string,
    public readonly unknownResult = false,
  ) {
    super(message);
    this.name = 'WebsitePublishError';
  }
}

export type WebsitePublishResult = {
  release: { id: string; sequence: number; status: string };
  production: { id: string; status: string; productionSlug: string };
  productionUrl: string;
  requiresAuthorization: boolean;
};

export function productionUrlForSlug(productionSlug: string): string {
  const slugValidation = normalizeProductionSlug(productionSlug);
  if (!slugValidation.valid)
    throw new WebsitePublishError('PRODUCTION_INGRESS_NOT_CONFIGURED', '正式网站标识无效');
  productionSlug = slugValidation.slug;
  const template = process.env.PRODUCTION_GATEWAY_ORIGIN_TEMPLATE;
  const hostSuffix = process.env.PRODUCTION_HOST_SUFFIX?.trim()
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
  if (!template || !template.includes('{productionSlug}'))
    throw new WebsitePublishError('PRODUCTION_INGRESS_NOT_CONFIGURED', '正式网站入口尚未配置');
  const value = template.replaceAll('{productionSlug}', productionSlug);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebsitePublishError('PRODUCTION_INGRESS_NOT_CONFIGURED', '正式网站入口配置无效');
  }
  if (
    !hostSuffix ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.toLowerCase().replace(/\.$/, '') !== `${productionSlug}.${hostSuffix}` ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new WebsitePublishError('PRODUCTION_INGRESS_NOT_CONFIGURED', '正式网站入口配置无效');
  return url.toString().replace(/\/$/, '');
}

/** Creates or resumes the durable release associated with this operation, then runs it. */
export async function publishWebsite(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  websiteId: string;
  ownerId: string | null;
  operationId: string;
  productionSlug: string;
  client: ProductionClient;
  workspaceClient: WorkspaceClient;
}): Promise<WebsitePublishResult> {
  productionUrlForSlug('00000000000000000000000000000000');
  const prepared = await preparePublish(input);
  const productionUrl = productionUrlForSlug(prepared.productionSlug);
  const idempotencyKey = `website-publish-${input.operationId}`;
  try {
    await input.workspaceClient.runtime.start({
      idempotencyKey: `${idempotencyKey}-workspace-start`,
      deadlineMs: 120_000,
    });
  } catch (error) {
    if (error instanceof WorkspaceClientError && error.code === 'UNKNOWN_RESULT')
      throw new WebsitePublishError('UNKNOWN_RESULT', 'Workspace 启动结果正在确认中', true);
    throw new WebsitePublishError('RELEASE_PREFLIGHT_FAILED', 'Workspace 当前无法启动');
  }
  let bootstrap: { cms?: unknown; version?: unknown; sourceCommit?: unknown };
  try {
    const marker = await input.workspaceClient.fs.read({
      path: '/workspace/.cloudcrane/bootstrap.json',
      maxBytes: 2_048,
    });
    bootstrap = JSON.parse(marker.content) as typeof bootstrap;
  } catch {
    throw new WebsitePublishError('RELEASE_PREFLIGHT_FAILED', '无法读取 PbootCMS 版本信息');
  }
  if (
    bootstrap.cms !== 'pbootcms' ||
    typeof bootstrap.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(bootstrap.version) ||
    typeof bootstrap.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(bootstrap.sourceCommit)
  )
    throw new WebsitePublishError(
      'RELEASE_PREFLIGHT_FAILED',
      'Workspace 中的 PbootCMS 基线信息无效',
    );

  const artifactStorageKey = `release-${prepared.releaseId}.zip`;
  let staged: Awaited<ReturnType<ProductionClient['stageRelease']>>;
  try {
    staged = await input.client.stageRelease(
      {
        artifactStorageKey,
        releaseId: prepared.releaseId,
        sourcePbootVersion: bootstrap.version,
        sourceCoreCommit: bootstrap.sourceCommit,
        firstPublish: prepared.firstPublish,
      },
      { idempotencyKey: `${idempotencyKey}-stage`, deadlineMs: 180_000 },
    );
  } catch (error) {
    if (isUnknown(error))
      throw new WebsitePublishError('UNKNOWN_RESULT', '发布结果正在确认中，请稍后刷新', true);
    if (error instanceof ProductionClientError && error.code === 'WORKSPACE_CHANGED_DURING_PUBLISH')
      throw new WebsitePublishError(
        'WORKSPACE_CHANGED_DURING_PUBLISH',
        '发布期间 Workspace 内容发生变化，请重新发布',
      );
    throw new WebsitePublishError('RELEASE_STAGE_FAILED', 'Release 制作失败');
  }

  await input.db
    .update(websiteRelease)
    .set({
      artifactStorageKey: staged.artifactStorageKey,
      artifactSha256: staged.artifactSha256,
      artifactSize: staged.artifactSize,
      sourcePbootVersion: bootstrap.version,
      sourceCoreCommit: bootstrap.sourceCommit,
      sourceGitHead: stringField(staged.manifest, 'sourceGitHead'),
      sourceGitDirty: staged.manifest.sourceGitDirty === true,
      status: 'staged',
      stagedAt: new Date(),
    })
    .where(eq(websiteRelease.id as never, prepared.releaseId));

  try {
    const ensured = await input.client.ensureRuntime(
      { productionSlug: prepared.productionSlug },
      { idempotencyKey: `${idempotencyKey}-ensure` },
    );
    await input.db
      .update(productionRuntime)
      .set({
        status: ensured.status,
        productionPort: ensured.productionPort,
        containerRef: ensured.containerRef,
        updatedAt: new Date(),
      })
      .where(eq(productionRuntime.id as never, prepared.runtimeId));

    await input.db
      .update(websiteRelease)
      .set({ status: 'activating' })
      .where(eq(websiteRelease.id as never, prepared.releaseId));
    await input.db
      .update(productionRuntime)
      .set({ status: 'activating', updatedAt: new Date() })
      .where(eq(productionRuntime.id as never, prepared.runtimeId));
    const activated = await input.client.deployRelease(
      {
        releaseId: prepared.releaseId,
        productionSlug: prepared.productionSlug,
        sequence: prepared.sequence,
        artifactStorageKey: staged.artifactStorageKey,
        artifactSha256: staged.artifactSha256,
        artifactSize: staged.artifactSize,
        firstPublish: prepared.firstPublish,
      },
      { idempotencyKey: `${idempotencyKey}-deploy`, deadlineMs: 180_000 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await input.db.transaction(async (tx: any) => {
      await tx
        .update(websiteRelease)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(websiteRelease.websiteId as never, input.websiteId),
            eq(websiteRelease.status as never, 'active'),
          ) as never,
        );
      await tx
        .update(websiteRelease)
        .set({ status: 'active', activatedAt: new Date() })
        .where(eq(websiteRelease.id as never, prepared.releaseId));
      await tx
        .update(productionRuntime)
        .set({
          status: activated.status,
          currentReleaseId: prepared.releaseId,
          updatedAt: new Date(),
          activatedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        .where(eq(productionRuntime.id as never, prepared.runtimeId));
    });
    return {
      release: { id: prepared.releaseId, sequence: prepared.sequence, status: 'active' },
      production: {
        id: prepared.runtimeId,
        status: activated.status,
        productionSlug: prepared.productionSlug,
      },
      productionUrl,
      requiresAuthorization: activated.status === 'authorization_required',
    };
  } catch (error) {
    if (isUnknown(error))
      throw new WebsitePublishError('UNKNOWN_RESULT', '发布结果正在确认中，请稍后刷新', true);
    let recovered: Awaited<ReturnType<ProductionClient['status']>> | undefined;
    try {
      recovered = await input.client.status({ productionSlug: prepared.productionSlug });
    } catch {
      // Keep the activating state so the public Production gateway stays closed
      // until a later status reconciliation can verify or restore a release.
    }
    const verifiedRecovery = recovered;
    if (
      verifiedRecovery &&
      verifiedRecovery.currentReleaseId === prepared.releaseId &&
      (verifiedRecovery.status === 'active' || verifiedRecovery.status === 'authorization_required')
    ) {
      try {
        // The Runner may have committed the verified release even if the RPC or
        // the first database finalization response was lost. Make the durable
        // Web records agree with that verified state before reporting success.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await input.db.transaction(async (tx: any) => {
          await tx
            .update(websiteRelease)
            .set({ status: 'superseded' })
            .where(
              and(
                eq(websiteRelease.websiteId as never, input.websiteId),
                eq(websiteRelease.status as never, 'active'),
              ) as never,
            );
          await tx
            .update(websiteRelease)
            .set({ status: 'active', activatedAt: new Date() })
            .where(eq(websiteRelease.id as never, prepared.releaseId));
          await tx
            .update(productionRuntime)
            .set({
              status: verifiedRecovery.status,
              currentReleaseId: prepared.releaseId,
              productionPort: verifiedRecovery.productionPort,
              updatedAt: new Date(),
              activatedAt: new Date(),
              lastErrorCode: null,
              lastErrorMessage: null,
            })
            .where(eq(productionRuntime.id as never, prepared.runtimeId));
        });
        return {
          release: { id: prepared.releaseId, sequence: prepared.sequence, status: 'active' },
          production: {
            id: prepared.runtimeId,
            status: verifiedRecovery.status,
            productionSlug: prepared.productionSlug,
          },
          productionUrl,
          requiresAuthorization: verifiedRecovery.status === 'authorization_required',
        };
      } catch {
        throw new WebsitePublishError('UNKNOWN_RESULT', '发布结果正在确认中，请稍后刷新', true);
      }
    }
    if (recovered) {
      try {
        await input.db
          .update(productionRuntime)
          .set({
            status: recovered.status === 'missing' ? 'failed' : recovered.status,
            currentReleaseId: recovered.currentReleaseId,
            productionPort: recovered.productionPort,
            updatedAt: new Date(),
            ...(recovered.status === 'missing'
              ? { lastErrorCode: 'PRODUCTION_RUNTIME_MISSING' }
              : { lastErrorCode: null, lastErrorMessage: null }),
          })
          .where(eq(productionRuntime.id as never, prepared.runtimeId));
      } catch {
        // Keep the activating state so the public Production gateway stays closed
        // until a later status reconciliation can verify or restore a release.
      }
    }
    const code = error instanceof ProductionClientError ? error.code : undefined;
    const publishCode: PublishErrorCode =
      code === 'PRODUCTION_STATE_CONFLICT'
        ? 'PRODUCTION_RUNTIME_FAILED'
        : 'RELEASE_ACTIVATION_FAILED';
    throw new WebsitePublishError(publishCode, 'Production 部署未能完成');
  }
}

async function preparePublish(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  websiteId: string;
  ownerId: string | null;
  operationId: string;
  productionSlug: string;
}) {
  const ingress = process.env.PRODUCTION_GATEWAY_ORIGIN_TEMPLATE;
  if (!ingress?.includes('{productionSlug}'))
    throw new WebsitePublishError('PRODUCTION_INGRESS_NOT_CONFIGURED', '正式网站入口尚未配置');
  const slugValidation = normalizeProductionSlug(input.productionSlug);
  if (!slugValidation.valid)
    throw new WebsitePublishError('WEBSITE_NOT_READY', '正式网址前缀格式无效或为平台保留名称');

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await input.db.transaction(async (tx: any) => {
      const sites = await tx
        .select({
          id: website.id,
          status: website.status,
          cmsType: website.cmsType,
          billingAccountId: website.billingAccountId,
        })
        .from(website)
        .where(
          input.ownerId
            ? and(
                eq(website.id as never, input.websiteId),
                eq(website.ownerId as never, input.ownerId),
              )
            : eq(website.id as never, input.websiteId),
        )
        .for('update');
      const site = sites[0];
      if (!site || site.status !== 'ready' || site.cmsType !== 'pbootcms' || !site.billingAccountId)
        throw new WebsitePublishError('WEBSITE_NOT_READY', '网站尚未准备好发布');
      const [workspaceRow] = await tx
        .select({ runnerId: workspace.runnerId, status: workspace.status })
        .from(workspace)
        .where(eq(workspace.websiteId as never, input.websiteId))
        .limit(1);
      if (
        !workspaceRow ||
        !['running', 'stopped'].includes(workspaceRow.status) ||
        !workspaceRow.runnerId
      )
        throw new WebsitePublishError('RELEASE_PREFLIGHT_FAILED', 'Workspace Runner 暂不可用');

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`website-publish-account:${site.billingAccountId}`}))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`website-lifecycle:${input.websiteId}`}))`,
      );
      const running = await tx
        .select({ id: agentRun.id })
        .from(agentRun)
        .where(
          and(
            eq(agentRun.websiteId as never, input.websiteId),
            inArray(agentRun.status as never, ['PENDING', 'RUNNING']),
          ) as never,
        )
        .limit(1);
      if (running.length)
        throw new WebsitePublishError('WEBSITE_BUSY', 'Agent 正在修改网站，请等待本次任务完成');

      const refreshing = await tx
        .select({ id: operation.id })
        .from(operation)
        .where(
          and(
            eq(operation.websiteId as never, input.websiteId),
            eq(operation.type as never, 'website.production.refresh'),
            inArray(operation.status as never, ['pending', 'running', 'retryable']),
          ),
        )
        .limit(1);
      if (refreshing.length)
        throw new WebsitePublishError('WEBSITE_BUSY', '正式网站内容正在刷新，请等待完成');

      const inFlight = await tx
        .select({ id: websiteRelease.id })
        .from(websiteRelease)
        .where(
          and(
            eq(websiteRelease.websiteId as never, input.websiteId),
            inArray(websiteRelease.status as never, ['preparing', 'staged', 'activating']),
            sql`${websiteRelease.id} <> ${input.operationId}`,
          ),
        )
        .limit(1);
      if (inFlight.length)
        throw new WebsitePublishError('PUBLISH_ALREADY_RUNNING', '已有发布任务正在处理中');

      const grantRows = await tx
        .select({
          id: entitlementGrant.id,
          featureKey: entitlementDefinition.key,
          valueType: entitlementDefinition.valueType,
          value: entitlementGrant.value,
          scope: entitlementGrant.scope,
          scopeId: entitlementGrant.scopeId,
          startsAt: entitlementGrant.startsAt,
          endsAt: entitlementGrant.endsAt,
        })
        .from(entitlementGrant)
        .innerJoin(
          entitlementDefinition,
          eq(entitlementGrant.entitlementDefinitionId as never, entitlementDefinition.id as never),
        )
        .where(
          and(
            eq(entitlementGrant.billingAccountId as never, site.billingAccountId),
            eq(entitlementGrant.status as never, 'active'),
            lte(entitlementGrant.startsAt as never, new Date()),
            or(
              isNull(entitlementGrant.endsAt as never),
              sql`${entitlementGrant.endsAt as never} > now()`,
            ),
            inArray(entitlementDefinition.key as never, [
              BILLING_FEATURES.productionEnabled,
              BILLING_FEATURES.productionWebsiteCount,
            ]),
          ),
        );
      const existingRows = await tx
        .select({
          id: productionRuntime.id,
          status: productionRuntime.status,
          productionSlug: productionRuntime.productionSlug,
        })
        .from(productionRuntime)
        .where(eq(productionRuntime.websiteId as never, input.websiteId))
        .limit(1);
      const usageRows = await tx
        .select({ value: count() })
        .from(productionRuntime)
        .innerJoin(website, eq(productionRuntime.websiteId as never, website.id as never))
        .where(
          and(
            eq(website.billingAccountId as never, site.billingAccountId),
            sql`${productionRuntime.status} <> 'deleting'`,
          ),
        );
      const admission = decideProductionAdmission({
        grants: mapProductionEntitlementGrants(grantRows, site.billingAccountId),
        billingAccountId: site.billingAccountId,
        currentWebsiteUsage: Number(usageRows[0]?.value ?? 0),
        alreadyHasRuntime: Boolean(existingRows[0]),
      });
      if (!admission.allowed) {
        const code: PublishErrorCode =
          admission.code === 'PRODUCTION_DISABLED'
            ? 'PRODUCTION_NOT_ENTITLED'
            : admission.code === 'PRODUCTION_QUOTA_EXCEEDED'
              ? 'PRODUCTION_QUOTA_EXCEEDED'
              : 'ENTITLEMENT_UNAVAILABLE';
        throw new WebsitePublishError(code, '当前账户没有可用的 Production 发布权益');
      }

      let runtime = existingRows[0];
      if (!runtime) {
        const [claimedSlug] = await tx
          .select({ id: productionDomain.id })
          .from(productionDomain)
          .where(eq(productionDomain.slug as never, slugValidation.slug) as never)
          .limit(1);
        if (claimedSlug)
          throw new WebsitePublishError('PRODUCTION_SLUG_TAKEN', '这个正式网址前缀已被使用');
        const [created] = await tx
          .insert(productionRuntime)
          .values({
            websiteId: input.websiteId,
            runnerId: workspaceRow.runnerId,
            status: 'provisioning',
            productionSlug: slugValidation.slug,
          })
          .returning({
            id: productionRuntime.id,
            productionSlug: productionRuntime.productionSlug,
          });
        if (!created)
          throw new WebsitePublishError('PRODUCTION_RUNTIME_FAILED', 'Production 记录创建失败');
        runtime = created;
        await tx.insert(productionDomain).values({
          productionRuntimeId: runtime.id,
          slug: slugValidation.slug,
          routeType: 'canonical',
        });
      } else if (runtime.productionSlug !== slugValidation.slug) {
        throw new WebsitePublishError(
          'PRODUCTION_SLUG_TAKEN',
          '正式网站前缀已确定，请先在设置中修改正式网址',
        );
      }

      const [current] = await tx
        .select({ releaseId: productionRuntime.currentReleaseId })
        .from(productionRuntime)
        .where(eq(productionRuntime.id as never, runtime.id))
        .limit(1);
      const firstPublish = current?.releaseId == null;
      const existingRelease = await tx
        .select({ id: websiteRelease.id, sequence: websiteRelease.sequence })
        .from(websiteRelease)
        .where(eq(websiteRelease.id as never, input.operationId))
        .limit(1);
      let release = existingRelease[0];
      if (!release) {
        const [max] = await tx
          .select({ value: sql<number>`coalesce(max(${websiteRelease.sequence}), 0)` })
          .from(websiteRelease)
          .where(eq(websiteRelease.websiteId as never, input.websiteId));
        const sequence = Number(max?.value ?? 0) + 1;
        const [created] = await tx
          .insert(websiteRelease)
          .values({
            id: input.operationId,
            websiteId: input.websiteId,
            sequence,
            status: 'preparing',
            previousReleaseId: current?.releaseId ?? null,
            createdByUserId: input.ownerId,
          })
          .returning({ id: websiteRelease.id, sequence: websiteRelease.sequence });
        if (!created)
          throw new WebsitePublishError('RELEASE_PREFLIGHT_FAILED', 'Release 记录创建失败');
        release = created;
      }
      return {
        runtimeId: runtime.id,
        productionSlug: runtime.productionSlug,
        releaseId: release.id,
        sequence: release.sequence,
        firstPublish,
      };
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    )
      throw new WebsitePublishError('PRODUCTION_SLUG_TAKEN', '这个正式网址前缀已被使用');
    throw error;
  }
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  const result = value[field];
  return typeof result === 'string' ? result : null;
}

function isUnknown(error: unknown): boolean {
  return error instanceof ProductionClientError && error.code === 'UNKNOWN_RESULT';
}
