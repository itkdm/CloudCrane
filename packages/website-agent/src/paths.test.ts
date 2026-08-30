import { describe, expect, it } from 'vitest';
import { AgentSessionPathLayout } from './paths.js';

const websiteId = '00000000-0000-4000-8000-000000000001';

describe('AgentSessionPathLayout', () => {
  it('allows only a single file under the website session directory', () => {
    const layout = new AgentSessionPathLayout('C:/cloudcrane-data');
    expect(
      layout.absoluteSessionFile(websiteId, `${websiteId}/agent/sessions/session.jsonl`),
    ).toContain('session.jsonl');
    expect(() =>
      layout.absoluteSessionFile(websiteId, `${websiteId}/agent/sessions/../secret.jsonl`),
    ).toThrow();
    expect(() => layout.absoluteSessionFile(websiteId, '../other/session.jsonl')).toThrow();
    expect(() =>
      layout.absoluteSessionFile(websiteId, `${websiteId}/agent/sessions/nested/session.jsonl`),
    ).toThrow();
  });
});
