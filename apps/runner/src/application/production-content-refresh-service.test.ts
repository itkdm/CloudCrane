import { describe, expect, it, vi } from 'vitest';
import { ProductionContentRefreshService } from './production-content-refresh-service.js';

const input = {
  websiteId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  productionSlug: 'production-website',
  refreshId: '00000000-0000-4000-8000-000000000003',
};

describe('ProductionContentRefreshService', () => {
  it('imports the Production snapshot into Workspace and removes the staged copy', async () => {
    const snapshot = {
      directory: '/artifacts/.production-refresh-00000000-0000-4000-8000-000000000003',
      databaseBytes: 4096,
      uploadFiles: 2,
      uploadBytes: 128,
    };
    const production = {
      snapshotContent: vi.fn().mockResolvedValue(snapshot),
      removeContentSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const workspace = {
      importProductionContent: vi.fn().mockResolvedValue({
        databaseBytes: snapshot.databaseBytes,
        uploadFiles: snapshot.uploadFiles,
        uploadBytes: snapshot.uploadBytes,
      }),
    };
    const service = new ProductionContentRefreshService(production as never, workspace as never);

    await expect(service.refresh(input)).resolves.toEqual({
      databaseBytes: 4096,
      uploadFiles: 2,
      uploadBytes: 128,
    });
    expect(production.snapshotContent).toHaveBeenCalledWith(
      input.websiteId,
      input.productionSlug,
      input.refreshId,
    );
    expect(workspace.importProductionContent).toHaveBeenCalledWith(input.workspaceId, {
      refreshId: input.refreshId,
      snapshotDirectory: snapshot.directory,
    });
    expect(production.removeContentSnapshot).toHaveBeenCalledWith(snapshot, input.refreshId);
  });

  it('cleans the staged copy when Workspace import fails', async () => {
    const snapshot = {
      directory: '/artifacts/.production-refresh-00000000-0000-4000-8000-000000000003',
      databaseBytes: 4096,
      uploadFiles: 2,
      uploadBytes: 128,
    };
    const production = {
      snapshotContent: vi.fn().mockResolvedValue(snapshot),
      removeContentSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const workspace = {
      importProductionContent: vi.fn().mockRejectedValue(new Error('snapshot failed validation')),
    };
    const service = new ProductionContentRefreshService(production as never, workspace as never);

    await expect(service.refresh(input)).rejects.toThrow('snapshot failed validation');
    expect(production.removeContentSnapshot).toHaveBeenCalledWith(snapshot, input.refreshId);
  });
});
