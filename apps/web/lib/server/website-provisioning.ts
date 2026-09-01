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

export type PublicWebsite = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
};

type WebsiteStore = {
  persistDesiredState(input: {
    websiteId: string;
    workspaceId: string;
    name: string;
  }): Promise<PublicWebsite>;
  updateWebsiteStatus(websiteId: string, status: string): Promise<void>;
  listWebsites(): Promise<PublicWebsite[]>;
};

type RuntimeClient = {
  create(): Promise<{ status: string }>;
  status(): Promise<{ status: string }>;
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
  return { id: row.id, name: row.name, status: row.status, createdAt: row.createdAt };
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
  let runtime: RuntimeClient | undefined;

  try {
    runtime = dependencies.runtime({ websiteId, workspaceId });
    const result = await runtime.create();
    await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_READY);
    return {
      website: { ...created, status: WEBSITE_READY },
      provisioned: result.status === 'running' || result.status === 'created',
    };
  } catch (error) {
    if (error instanceof WorkspaceClientError && error.code === 'UNKNOWN_RESULT') {
      try {
        if (runtime) {
          const status = await runtime.status();
          if (status.status === 'running' || status.status === 'created') {
            await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_READY);
            return {
              website: { ...created, status: WEBSITE_READY },
              provisioned: true,
            };
          }
        }
      } catch {
        // The record is retained and marked failed below when reconciliation is inconclusive.
      }
    }
    await dependencies.store.updateWebsiteStatus(websiteId, WEBSITE_PROVISIONING_FAILED);
    logger.warn(
      {
        websiteId,
        workspaceId,
        errorCode: error instanceof WorkspaceClientError ? error.code : 'UNKNOWN',
      },
      'website workspace provisioning failed',
    );
    return {
      website: { ...created, status: WEBSITE_PROVISIONING_FAILED },
      provisioned: false,
    };
  }
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
  };
  return { platform, store };
}

export function createProductionRuntime(websiteId: string, workspaceId: string): RuntimeClient {
  const endpoint = process.env.WORKSPACE_GATEWAY_ENDPOINT;
  const token = process.env.WORKSPACE_GATEWAY_CLIENT_TOKEN;
  if (!endpoint || !token) throw new Error('workspace gateway configuration is required');
  const client = new WorkspaceClient(endpoint, token, { websiteId, workspaceId });
  return {
    create: () => client.runtime.create().then((result) => ({ status: result.status })),
    status: () => client.runtime.status().then((result) => ({ status: result.status })),
  };
}
