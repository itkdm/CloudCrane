import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { createPlatformDb, website, workspace } from '@cloudcrane/db';
import { createLogger } from '@cloudcrane/shared';
import { WorkspaceClient, WorkspaceClientError } from '@cloudcrane/workspace-client';

export const WEBSITE_CMS_TYPE = 'pbootcms';
export const WORKSPACE_PROVIDER = 'docker';
export const WEBSITE_PROVISIONING = 'provisioning';
export const WEBSITE_READY = 'ready';
export const WEBSITE_PROVISIONING_FAILED = 'provisioning_failed';
export const WEBSITE_INITIALIZING = 'initializing';
export const WEBSITE_INITIALIZATION_FAILED = 'initialization_failed';
export const WEBSITE_AUTHORIZATION_REQUIRED = 'authorization_required';

export type PublicWebsite = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  previewUrl?: string;
};

type WebsiteStore = {
  persistDesiredState(input: {
    websiteId: string;
    workspaceId: string;
    name: string;
  }): Promise<PublicWebsite>;
  updateWebsiteStatus(websiteId: string, status: string): Promise<void>;
  listWebsites(): Promise<PublicWebsite[]>;
  findWorkspaceId?(websiteId: string): Promise<string | null>;
};

type RuntimeClient = {
  create(): Promise<{ status: string }>;
  status(): Promise<{ status: string }>;
  bootstrap(): Promise<{ status: string }>;
  reconcileBootstrap(): Promise<boolean>;
  configureAuthorization(sn: string): Promise<{ status: string }>;
  verifyAuthorization(canonicalHost: string): Promise<boolean>;
};

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
  },
): Promise<{ website: PublicWebsite; provisioned: boolean }> {
  const name = validateWebsiteName(value);
  const websiteId = randomUUID();
  const workspaceId = randomUUID();
  const logger = createLogger('web');
  const created = await dependencies.store.persistDesiredState({ websiteId, workspaceId, name });
  const failed = async (status: string, error?: unknown) => {
    await dependencies.store.updateWebsiteStatus(websiteId, status);
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
  await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_AUTHORIZATION_REQUIRED);
  return {
    website: { ...created, status: WEBSITE_AUTHORIZATION_REQUIRED },
    provisioned: true,
  };
}

export function createProductionWebsiteStore() {
  const platform = createPlatformDb();
  const store: WebsiteStore = {
    async persistDesiredState(input) {
      let created: PublicWebsite | undefined;
      // The web package and the DB package resolve Drizzle from separate workspace paths.
      // Keep this wiring local while the shared DB package remains the schema owner.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = platform.db;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.transaction(async (tx: any) => {
        const [row] = await tx
          .insert(website)
          .values({
            id: input.websiteId,
            name: input.name,
            status: WEBSITE_PROVISIONING,
            cmsType: WEBSITE_CMS_TYPE,
          })
          .returning({
            id: website.id,
            name: website.name,
            status: website.status,
            createdAt: website.createdAt,
          });
        await tx.insert(workspace).values({
          id: input.workspaceId,
          websiteId: input.websiteId,
          provider: WORKSPACE_PROVIDER,
          status: 'missing',
        });
        created = row;
      });
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
        })
        .from(website)
        .orderBy(desc(website.createdAt as never));
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
        marker.content.includes('"sourceCommit": "29ff72ee5afc9c6553b949f04d3fc99443879f40"') &&
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
  };
}
