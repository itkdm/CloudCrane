import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  createPlatformDb,
  template,
  website,
  websiteTemplateAttachment,
  workspace,
} from '@cloudcrane/db';
import { createLogger, generatePreviewSlug } from '@cloudcrane/shared';
import { WorkspaceClient, WorkspaceClientError } from '@cloudcrane/workspace-client';

export const WEBSITE_CMS_TYPE = 'pbootcms';
export const WORKSPACE_PROVIDER = 'docker';
export const WEBSITE_PROVISIONING = 'provisioning';
export const WEBSITE_READY = 'ready';
export const WEBSITE_PROVISIONING_FAILED = 'provisioning_failed';
export const WEBSITE_INITIALIZING = 'initializing';
export const WEBSITE_INITIALIZATION_FAILED = 'initialization_failed';
export const WEBSITE_AUTHORIZATION_REQUIRED = 'authorization_required';
export const WEBSITE_TEMPLATE_ATTACH_FAILED = 'template_attach_failed';
export const TEMPLATE_ATTACHMENT_STALE_AFTER_MS = 10 * 60 * 1000;

export type PublicWebsite = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  previewSlug?: string | null;
  previewUrl?: string;
};

type WebsiteStore = {
  persistDesiredState(input: {
    websiteId: string;
    workspaceId: string;
    name: string;
    ownerId: string;
    template?: {
      id: string;
      artifactStorageKey: string;
      artifactSha256: string;
    };
  }): Promise<PublicWebsite>;
  updateWebsiteStatus(websiteId: string, status: string): Promise<void>;
  reconcileReadyTemplateAttachment?(websiteId: string): Promise<void>;
  finalizeTemplateAttachment?(input: {
    websiteId: string;
    status: 'ready' | 'failed';
    websiteStatus: string;
    expectedAttemptCount: number;
    referenceId?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<boolean>;
  updateTemplateAttachment?(input: {
    websiteId: string;
    status: string;
    referenceId?: string;
    errorCode?: string;
    errorMessage?: string;
    incrementAttempt?: boolean;
    expectedStatus?: string | string[];
    expectedAttemptCount?: number;
    staleBefore?: Date;
  }): Promise<number | boolean | void>;
  findTemplateAttachment?(websiteId: string): Promise<{
    templateId: string;
    artifactStorageKey: string;
    artifactSha256: string;
    artifactType?: string;
    status: string;
    referenceId: string | null;
    attemptCount: number;
    updatedAt: Date;
  } | null>;
  listWebsites(): Promise<PublicWebsite[]>;
  findWorkspaceId?(websiteId: string): Promise<string | null>;
  findWorkspace?(websiteId: string): Promise<{ id: string; status: string } | null>;
  findPreviewSlug?(websiteId: string): Promise<string | null>;
  deleteWebsite?(websiteId: string): Promise<boolean>;
};

type RuntimeClient = {
  create(): Promise<{ status: string }>;
  status(): Promise<{ status: string }>;
  bootstrap(): Promise<{ status: string }>;
  reconcileBootstrap(): Promise<boolean>;
  configureAuthorization(sn: string): Promise<{ status: string }>;
  verifyAuthorization(canonicalHost: string): Promise<boolean>;
  destroy?(): Promise<void>;
  applyTemplateSnapshot?(referenceId: string): Promise<{ status: string }>;
};

type TemplateAttachment = {
  id: string;
  artifactStorageKey: string;
  artifactSha256: string;
  artifactType?: string;
};

async function finalizeTemplateAttachment(
  store: Pick<
    WebsiteStore,
    'updateWebsiteStatus' | 'updateTemplateAttachment' | 'finalizeTemplateAttachment'
  >,
  input: {
    websiteId: string;
    status: 'ready' | 'failed';
    websiteStatus: string;
    expectedAttemptCount?: number;
    referenceId?: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<boolean> {
  if (store.finalizeTemplateAttachment && input.expectedAttemptCount !== undefined)
    return store.finalizeTemplateAttachment({
      websiteId: input.websiteId,
      status: input.status,
      websiteStatus: input.websiteStatus,
      expectedAttemptCount: input.expectedAttemptCount,
      ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    });

  const updated = await store.updateTemplateAttachment?.({
    websiteId: input.websiteId,
    status: input.status,
    ...(input.referenceId ? { referenceId: input.referenceId } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    expectedStatus: 'materializing',
    ...(input.expectedAttemptCount === undefined
      ? {}
      : { expectedAttemptCount: input.expectedAttemptCount }),
  });
  if (updated === false) return false;
  await store.updateWebsiteStatus(input.websiteId, input.websiteStatus);
  return true;
}

export class WebsiteProvisioningError extends Error {
  constructor(
    public readonly code: 'INVALID_NAME' | 'PROVISIONING_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'WebsiteProvisioningError';
  }
}

export function validateWebsiteName(value: unknown): string {
  if (typeof value !== 'string')
    throw new WebsiteProvisioningError('INVALID_NAME', '网站名称不能为空');
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > 80)
    throw new WebsiteProvisioningError('INVALID_NAME', '网站名称长度须为 1 至 80 个字符');
  return name;
}

export function publicWebsiteView(row: PublicWebsite): PublicWebsite {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    ...(row.previewSlug ? { previewSlug: row.previewSlug } : {}),
    ...(row.previewUrl ? { previewUrl: row.previewUrl } : {}),
  };
}

export async function listWebsites(
  store: Pick<WebsiteStore, 'listWebsites'>,
): Promise<PublicWebsite[]> {
  return (await store.listWebsites()).map(publicWebsiteView);
}

export async function createWebsite(
  value: unknown,
  dependencies: {
    store: WebsiteStore;
    runtime: (context: { websiteId: string; workspaceId: string }) => RuntimeClient;
    ownerId: string;
    template?: TemplateAttachment;
    attachTemplate?: (input: {
      websiteId: string;
      workspaceId: string;
      template: TemplateAttachment;
    }) => Promise<{ referenceId: string }>;
  },
): Promise<{ website: PublicWebsite; provisioned: boolean }> {
  const name = validateWebsiteName(value);
  const websiteId = randomUUID();
  const workspaceId = randomUUID();
  const logger = createLogger('web');
  const created = await dependencies.store.persistDesiredState({
    websiteId,
    workspaceId,
    name,
    ownerId: dependencies.ownerId,
    ...(dependencies.template ? { template: dependencies.template } : {}),
  });
  const failed = async (status: string, error?: unknown) => {
    await dependencies.store.updateWebsiteStatus(websiteId, status);
    if (dependencies.template)
      await dependencies.store.updateTemplateAttachment?.({
        websiteId,
        status: 'failed',
        errorCode: error instanceof Error ? error.name : 'PROVISIONING_FAILED',
        errorMessage: error instanceof Error ? error.message : 'website provisioning failed',
      });
    logger.warn(
      {
        websiteId,
        workspaceId,
        errorCode: error instanceof WorkspaceClientError ? error.code : 'UNKNOWN',
        status,
      },
      'website provisioning did not complete',
    );
    return { website: { ...created, status }, provisioned: false };
  };

  let runtime: RuntimeClient;
  try {
    runtime = dependencies.runtime({ websiteId, workspaceId });
  } catch (error) {
    return failed(WEBSITE_PROVISIONING_FAILED, error);
  }

  let runtimeStatus: string;
  try {
    runtimeStatus = (await runtime.create()).status;
  } catch (error) {
    if (!(error instanceof WorkspaceClientError) || error.code !== 'UNKNOWN_RESULT')
      return failed(WEBSITE_PROVISIONING_FAILED, error);
    try {
      runtimeStatus = (await runtime.status()).status;
    } catch (reconciliationError) {
      return failed(WEBSITE_PROVISIONING_FAILED, reconciliationError);
    }
  }
  if (runtimeStatus !== 'running' && runtimeStatus !== 'created')
    return failed(WEBSITE_PROVISIONING_FAILED);

  await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_INITIALIZING);
  try {
    let bootstrapStatus: string;
    try {
      bootstrapStatus = (await runtime.bootstrap()).status;
    } catch (error) {
      if (!(error instanceof WorkspaceClientError) || error.code !== 'UNKNOWN_RESULT')
        return failed(WEBSITE_INITIALIZATION_FAILED, error);
      if (!(await runtime.reconcileBootstrap()))
        return failed(WEBSITE_INITIALIZATION_FAILED, error);
      bootstrapStatus = 'RECONCILED';
    }
    if (
      bootstrapStatus !== 'INITIALIZED' &&
      bootstrapStatus !== 'ALREADY_INITIALIZED' &&
      bootstrapStatus !== 'RECONCILED'
    )
      return failed(WEBSITE_INITIALIZATION_FAILED);
  } catch (error) {
    return failed(WEBSITE_INITIALIZATION_FAILED, error);
  }
  if (dependencies.template && !dependencies.attachTemplate)
    return failed(
      WEBSITE_TEMPLATE_ATTACH_FAILED,
      new Error('template attachment is not configured'),
    );
  if (dependencies.template && dependencies.attachTemplate) {
    const claimed = await dependencies.store.updateTemplateAttachment?.({
      websiteId,
      status: 'materializing',
      incrementAttempt: true,
      expectedStatus: 'pending',
    });
    if (claimed === false)
      throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板应用已被其他任务接管');
    const claimedAttempt = typeof claimed === 'number' ? claimed : undefined;
    let reference: { referenceId: string };
    try {
      reference = await dependencies.attachTemplate({
        websiteId,
        workspaceId,
        template: dependencies.template,
      });
      if (dependencies.template.artifactType === 'cloudcrane-pboot-site-snapshot') {
        if (!runtime.applyTemplateSnapshot)
          throw new Error('Pboot snapshot restore is not configured');
        await runtime.applyTemplateSnapshot(reference.referenceId);
      }
    } catch (error) {
      const failed = await finalizeTemplateAttachment(dependencies.store, {
        websiteId,
        status: 'failed',
        websiteStatus: WEBSITE_TEMPLATE_ATTACH_FAILED,
        expectedAttemptCount: claimedAttempt,
        errorCode: error instanceof Error ? error.name : 'TEMPLATE_ATTACH_FAILED',
        errorMessage: error instanceof Error ? error.message : 'template attachment failed',
      });
      if (!failed) throw error;
      return {
        website: { ...created, status: WEBSITE_TEMPLATE_ATTACH_FAILED },
        provisioned: false,
      };
    }
    const completed = await finalizeTemplateAttachment(dependencies.store, {
      websiteId,
      status: 'ready',
      websiteStatus: WEBSITE_AUTHORIZATION_REQUIRED,
      expectedAttemptCount: claimedAttempt,
      referenceId: reference.referenceId,
    });
    if (!completed)
      throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板应用已被其他任务接管');
  }
  if (!dependencies.template)
    await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_AUTHORIZATION_REQUIRED);
  return {
    website: { ...created, status: WEBSITE_AUTHORIZATION_REQUIRED },
    provisioned: true,
  };
}

export async function retryTemplateAttachment(
  websiteId: string,
  dependencies: {
    store: Pick<
      WebsiteStore,
      | 'findTemplateAttachment'
      | 'updateTemplateAttachment'
      | 'updateWebsiteStatus'
      | 'reconcileReadyTemplateAttachment'
      | 'finalizeTemplateAttachment'
    >;
    workspaceId: string;
    attachTemplate: (input: {
      websiteId: string;
      workspaceId: string;
      template: TemplateAttachment;
    }) => Promise<{ referenceId: string }>;
    applyTemplateSnapshot?: (referenceId: string) => Promise<{ status: string }>;
  },
): Promise<{ referenceId: string }> {
  const attachment = await dependencies.store.findTemplateAttachment?.(websiteId);
  if (!attachment) throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板关联不存在');
  if (attachment.status === 'ready' && attachment.referenceId) {
    if (dependencies.store.reconcileReadyTemplateAttachment)
      await dependencies.store.reconcileReadyTemplateAttachment(websiteId);
    else await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_AUTHORIZATION_REQUIRED);
    return { referenceId: attachment.referenceId };
  }
  const staleBefore = new Date(Date.now() - TEMPLATE_ATTACHMENT_STALE_AFTER_MS);
  if (attachment.status === 'materializing' && attachment.updatedAt > staleBefore)
    throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板正在应用，请稍后重试');
  const claimed = await dependencies.store.updateTemplateAttachment?.({
    websiteId,
    status: 'materializing',
    incrementAttempt: true,
    expectedStatus: attachment.status === 'materializing' ? 'materializing' : 'failed',
    ...(attachment.status === 'materializing' ? { staleBefore } : {}),
  });
  if (typeof claimed !== 'number')
    throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板正在应用，请稍后重试');
  let result: { referenceId: string };
  try {
    result = await dependencies.attachTemplate({
      websiteId,
      workspaceId: dependencies.workspaceId,
      template: { id: attachment.templateId, ...attachment },
    });
    if (
      attachment.artifactType === 'cloudcrane-pboot-site-snapshot' &&
      dependencies.applyTemplateSnapshot
    )
      await dependencies.applyTemplateSnapshot(result.referenceId);
  } catch (error) {
    const failed = await finalizeTemplateAttachment(dependencies.store, {
      websiteId,
      status: 'failed',
      websiteStatus: WEBSITE_TEMPLATE_ATTACH_FAILED,
      expectedAttemptCount: claimed,
      errorCode: error instanceof Error ? error.name : 'TEMPLATE_ATTACH_FAILED',
      errorMessage: error instanceof Error ? error.message : 'template attachment failed',
    });
    if (!failed) throw error;
    throw error;
  }
  const completed = await finalizeTemplateAttachment(dependencies.store, {
    websiteId,
    status: 'ready',
    websiteStatus: WEBSITE_AUTHORIZATION_REQUIRED,
    expectedAttemptCount: claimed,
    referenceId: result.referenceId,
  });
  if (!completed)
    throw new WebsiteProvisioningError('PROVISIONING_FAILED', '模板应用已被其他任务接管');
  return result;
}

export function createProductionWebsiteStore(ownerId?: string) {
  const platform = createPlatformDb();
  const store: WebsiteStore = {
    async persistDesiredState(input) {
      let created: PublicWebsite | undefined;
      // The web package and the DB package resolve Drizzle from separate workspace paths.
      // Keep this wiring local while the shared DB package remains the schema owner.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const previewSlug = generatePreviewSlug();
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.transaction(async (tx: any) => {
            const [row] = await tx
              .insert(website)
              .values({
                id: input.websiteId,
                name: input.name,
                ownerId: input.ownerId,
                previewSlug,
                status: WEBSITE_PROVISIONING,
                cmsType: WEBSITE_CMS_TYPE,
              })
              .returning({
                id: website.id,
                name: website.name,
                status: website.status,
                createdAt: website.createdAt,
                previewSlug: website.previewSlug,
              });
            await tx.insert(workspace).values({
              id: input.workspaceId,
              websiteId: input.websiteId,
              provider: WORKSPACE_PROVIDER,
              status: 'missing',
            });
            if (input.template) {
              await tx.insert(websiteTemplateAttachment).values({
                websiteId: input.websiteId,
                templateId: input.template.id,
                artifactStorageKey: input.template.artifactStorageKey,
                artifactSha256: input.template.artifactSha256,
                status: 'pending',
              });
            }
            created = row;
          });
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== '23505' || attempt === 4) throw error;
        }
      }
      if (!created) throw new Error('website record was not created');
      return created;
    },
    async updateWebsiteStatus(websiteId, status) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      await db
        .update(website)
        .set({ status, updatedAt: new Date() })
        .where(eq(website.id as never, websiteId));
    },
    async listWebsites() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      return db
        .select({
          id: website.id,
          name: website.name,
          status: website.status,
          createdAt: website.createdAt,
          previewSlug: website.previewSlug,
        })
        .from(website)
        .where(ownerId ? eq(website.ownerId as never, ownerId) : undefined)
        .orderBy(desc(website.createdAt as never));
    },
    async finalizeTemplateAttachment(input) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.transaction(async (tx: any) => {
        const attachmentRows = await tx
          .update(websiteTemplateAttachment)
          .set({
            status: input.status,
            ...(input.referenceId
              ? { referenceId: input.referenceId, completedAt: new Date() }
              : {}),
            ...(input.status === 'ready'
              ? { completedAt: new Date(), lastErrorCode: null, lastErrorMessage: null }
              : {
                  completedAt: null,
                  lastErrorCode: input.errorCode ?? null,
                  lastErrorMessage: input.errorMessage ?? null,
                }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(websiteTemplateAttachment.websiteId as never, input.websiteId),
              eq(websiteTemplateAttachment.status as never, 'materializing'),
              eq(websiteTemplateAttachment.attemptCount as never, input.expectedAttemptCount),
            ),
          )
          .returning({ id: websiteTemplateAttachment.id });
        if (attachmentRows.length === 0) return false;

        const websiteRows = await tx
          .update(website)
          .set({ status: input.websiteStatus, updatedAt: new Date() })
          .where(
            and(
              eq(website.id as never, input.websiteId),
              inArray(website.status as never, [
                WEBSITE_INITIALIZING,
                WEBSITE_TEMPLATE_ATTACH_FAILED,
                WEBSITE_AUTHORIZATION_REQUIRED,
              ]),
            ),
          )
          .returning({ id: website.id });
        if (websiteRows.length === 0)
          throw new Error('website finalization state changed before template attachment commit');
        return true;
      });
    },
    async reconcileReadyTemplateAttachment(websiteId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      await db
        .update(website)
        .set({ status: WEBSITE_AUTHORIZATION_REQUIRED, updatedAt: new Date() })
        .where(
          and(
            eq(website.id as never, websiteId),
            inArray(website.status as never, [
              WEBSITE_INITIALIZING,
              WEBSITE_TEMPLATE_ATTACH_FAILED,
              WEBSITE_AUTHORIZATION_REQUIRED,
            ]),
          ),
        );
    },
    async updateTemplateAttachment(input) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const conditions = [eq(websiteTemplateAttachment.websiteId as never, input.websiteId)];
      if (input.expectedStatus) {
        conditions.push(
          Array.isArray(input.expectedStatus)
            ? inArray(websiteTemplateAttachment.status as never, input.expectedStatus)
            : eq(websiteTemplateAttachment.status as never, input.expectedStatus),
        );
      }
      if (input.staleBefore)
        conditions.push(lt(websiteTemplateAttachment.updatedAt as never, input.staleBefore));
      if (input.expectedAttemptCount !== undefined)
        conditions.push(
          eq(websiteTemplateAttachment.attemptCount as never, input.expectedAttemptCount),
        );
      const result = await db
        .update(websiteTemplateAttachment)
        .set({
          status: input.status,
          ...(input.incrementAttempt
            ? { attemptCount: sql`${websiteTemplateAttachment.attemptCount} + 1` }
            : {}),
          ...(input.referenceId ? { referenceId: input.referenceId, completedAt: new Date() } : {}),
          ...(input.status === 'materializing' || input.status === 'ready'
            ? { lastErrorCode: null, lastErrorMessage: null }
            : {}),
          ...(input.status === 'ready' ? { completedAt: new Date() } : {}),
          ...(input.status === 'failed' ? { completedAt: null } : {}),
          ...(input.errorCode ? { lastErrorCode: input.errorCode } : {}),
          ...(input.errorMessage ? { lastErrorMessage: input.errorMessage } : {}),
          updatedAt: new Date(),
        })
        .where(and(...conditions))
        .returning({
          id: websiteTemplateAttachment.id,
          attemptCount: websiteTemplateAttachment.attemptCount,
        });
      if (result.length === 0) return false;
      return input.incrementAttempt ? result[0].attemptCount : true;
    },
    async findTemplateAttachment(websiteId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const rows = await db
        .select({
          templateId: websiteTemplateAttachment.templateId,
          artifactStorageKey: websiteTemplateAttachment.artifactStorageKey,
          artifactSha256: websiteTemplateAttachment.artifactSha256,
          artifactType: template.artifactType,
          status: websiteTemplateAttachment.status,
          referenceId: websiteTemplateAttachment.referenceId,
          attemptCount: websiteTemplateAttachment.attemptCount,
          updatedAt: websiteTemplateAttachment.updatedAt,
        })
        .from(websiteTemplateAttachment)
        .innerJoin(
          template,
          eq(websiteTemplateAttachment.templateId as never, template.id as never),
        )
        .where(eq(websiteTemplateAttachment.websiteId as never, websiteId))
        .limit(1);
      return rows[0] ?? null;
    },
    async findWorkspaceId(websiteId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const rows = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.websiteId as never, websiteId))
        .limit(1);
      return rows[0]?.id ?? null;
    },
    async findWorkspace(websiteId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const conditions = [eq(workspace.websiteId as never, websiteId)];
      if (ownerId) conditions.push(eq(website.ownerId as never, ownerId));
      const rows = await db
        .select({ id: workspace.id, status: workspace.status })
        .from(workspace)
        .innerJoin(website, eq(workspace.websiteId as never, website.id as never))
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    },
    async findPreviewSlug(websiteId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const rows = await db
        .select({ previewSlug: website.previewSlug })
        .from(website)
        .where(eq(website.id as never, websiteId))
        .limit(1);
      return rows[0]?.previewSlug ?? null;
    },
    async deleteWebsite(websiteId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      const conditions = [eq(website.id as never, websiteId)];
      if (ownerId) conditions.push(eq(website.ownerId as never, ownerId));
      const deleted = await db
        .delete(website)
        .where(and(...conditions))
        .returning({ id: website.id });
      return deleted.length > 0;
    },
  };
  return { platform, store };
}

export function createProductionRuntime(websiteId: string, workspaceId: string): RuntimeClient {
  const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
  const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
  if (!endpoint || !token) throw new Error('workspace gateway configuration is required');
  const client = new WorkspaceClient(endpoint, token, { websiteId, workspaceId });
  const exec = (
    command: string,
    args: string[],
    timeoutMs = 120_000,
    env: Record<string, string> = {},
  ) =>
    client.process.exec({
      command,
      args,
      cwd: '/workspace',
      env,
      timeoutMs,
      maxOutputBytes: 8_192,
      executionId: randomUUID(),
    });
  return {
    create: () => client.runtime.create().then((result) => ({ status: result.status })),
    status: () => client.runtime.status().then((result) => ({ status: result.status })),
    bootstrap: async () => {
      const result = await exec('cloudcrane-init-pboot', []);
      return { status: result.exitCode === 0 ? result.stdout.trim() : 'FAILED' };
    },
    reconcileBootstrap: async () => {
      const marker = await client.fs.read({
        path: '/workspace/.cloudcrane/bootstrap.json',
        maxBytes: 2_048,
      });
      const required = [
        '/workspace/index.php',
        '/workspace/admin.php',
        '/workspace/data/pbootcms.db',
      ];
      for (const path of required) await client.fs.stat({ path });
      const verification = await exec(
        'sh',
        [
          '-c',
          'sqlite3 /workspace/data/pbootcms.db "PRAGMA integrity_check;" | grep -qxF ok && php -r \'$db = new PDO("sqlite:/workspace/data/pbootcms.db"); exit($db->query("PRAGMA integrity_check")->fetchColumn() === "ok" ? 0 : 1);\'',
        ],
        30_000,
      );
      return (
        marker.content.includes('"sourceCommit": "8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea"') &&
        verification.exitCode === 0
      );
    },
    configureAuthorization: async (sn: string) => {
      const result = await exec('cloudcrane-pboot-license', [], 30_000, {
        PBOOT_SN: sn,
        PBOOT_SN_USER: '',
      });
      return { status: result.exitCode === 0 ? result.stdout.trim() : 'FAILED' };
    },
    verifyAuthorization: async (canonicalHost: string) => {
      const result = await exec(
        'curl',
        [
          '--fail',
          '--silent',
          '--show-error',
          '--max-time',
          '20',
          '--header',
          `Host: ${canonicalHost}`,
          '--header',
          `X-Forwarded-Host: ${canonicalHost}`,
          '--header',
          'X-Forwarded-Proto: https',
          'http://127.0.0.1:8080/',
        ],
        30_000,
      );
      return result.exitCode === 0;
    },
    destroy: async () => {
      await client.runtime.destroy({ idempotencyKey: `website-delete-${websiteId}` });
    },
    applyTemplateSnapshot: async (referenceId: string) => {
      const result = await exec('cloudcrane-apply-pboot-snapshot', [referenceId], 120_000);
      if (result.exitCode !== 0)
        throw new Error(result.stderr.trim() || 'Pboot snapshot restore failed');
      return { status: result.stdout.trim() };
    },
  };
}
