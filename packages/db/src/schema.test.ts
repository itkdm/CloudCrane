import { describe, expect, it } from 'vitest';
import { agentRun, runner, website, websiteSession, workspace } from './schema.js';

describe('platform schema', () => {
  it('exports the five baseline tables', () => {
    expect(Object.keys({ website, workspace, websiteSession, agentRun, runner })).toHaveLength(5);
  });
});
