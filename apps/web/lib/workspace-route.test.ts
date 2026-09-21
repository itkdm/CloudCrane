import { describe, expect, it } from 'vitest';
import { buildWorkspacePath } from './workspace-route';

describe('buildWorkspacePath', () => {
  it('uses a nested resource path for a selected session', () => {
    expect(
      buildWorkspacePath('zh', {
        view: 'websites',
        websiteId: 'website/1',
        sessionId: 'session?1',
      }),
    ).toBe('/zh/app/websites/website%2F1/sessions/session%3F1');
  });

  it('keeps templates as a view query on the collection route', () => {
    expect(buildWorkspacePath('en', { view: 'templates' })).toBe('/en/app/websites?view=templates');
  });

  it('keeps the selected website route when no session is selected', () => {
    expect(buildWorkspacePath('zh', { view: 'websites', websiteId: 'website-1' })).toBe(
      '/zh/app/websites/website-1/sessions',
    );
  });
});
