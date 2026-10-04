import type { ProductionRequestOptions, ProductionClient } from './production-client.js';

export class CmsClient {
  constructor(private readonly production: ProductionClient) {}

  listCategories(input: { limit?: number; cursor?: string }, options?: ProductionRequestOptions) {
    return this.production.cmsListCategories(input, options);
  }

  listContent(
    input: {
      categoryCode?: string;
      query?: string;
      status?: '0' | '1';
      limit?: number;
      cursor?: string;
    },
    options?: ProductionRequestOptions,
  ) {
    return this.production.cmsListContent(input, options);
  }

  getContent(input: { contentId: string }, options?: ProductionRequestOptions) {
    return this.production.cmsGetContent(input, options);
  }

  uploadMedia(
    input: {
      attachmentId: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      contentSha256: string;
      contentBase64: string;
    },
    options: ProductionRequestOptions & { idempotencyKey: string },
  ) {
    return this.production.cmsUploadMedia(input, options);
  }

  createContent(
    input: Record<string, unknown> & { categoryCode: string; title: string },
    options: ProductionRequestOptions & { idempotencyKey: string },
  ) {
    return this.production.cmsCreateContent(input, options);
  }

  updateContent(
    input: { contentId: string; expectedVersion: string; patch: Record<string, unknown> },
    options?: ProductionRequestOptions,
  ) {
    return this.production.cmsUpdateContent(input, options);
  }

  getCompany(options?: ProductionRequestOptions) {
    return this.production.cmsGetCompany(options);
  }

  updateCompany(
    input: { expectedVersion: string; patch: Record<string, unknown> },
    options?: ProductionRequestOptions,
  ) {
    return this.production.cmsUpdateCompany(input, options);
  }
}
