import { describe, expect, it, vi } from 'vitest';
import { HumanInteractionBroker } from './human-interaction-broker.js';

const base = {
  kind: 'question' as const,
  websiteId: 'website-a',
  sessionId: 'session-a',
  runId: 'run-a',
  toolCallId: 'tool-a',
  question: 'Choose a style',
  options: [{ label: 'Modern' }, { label: 'Classic' }],
  allowCustom: true as const,
  piSessionId: 'pi-session-1',
};

describe('HumanInteractionBroker', () => {
  it('resolves a reference upload with site/session isolation', async () => {
    const requested = vi.fn();
    const broker = new HumanInteractionBroker(requested);
    const promise = broker.requestReferenceUpload({
      kind: 'reference_upload',
      websiteId: 'website-a',
      sessionId: 'session-a',
      piSessionId: 'pi-session-1',
      runId: 'run-a',
      toolCallId: 'tool-reference',
      accept: ['.zip'],
      maxBytes: 100,
    });
    const interaction = requested.mock.calls[0]?.[0];
    expect(interaction.kind).toBe('reference_upload');
    expect(
      broker.isPendingReferenceUpload(interaction.interactionId, 'website-a', 'session-a'),
    ).toBe(true);
    expect(
      broker.resolveReferenceUpload(interaction.interactionId, 'website-b', 'session-a', {
        referenceId: 'ref-1',
        name: 'site.zip',
        logicalPath: '/workspace/.cloudcrane/references/ref-1',
        sha256: 'sha',
        size: 10,
      }),
    ).toBe(false);
    const result = {
      referenceId: 'ref-1',
      name: 'site.zip',
      logicalPath: '/workspace/.cloudcrane/references/ref-1',
      sha256: 'sha',
      size: 10,
    };
    expect(
      broker.resolveReferenceUpload(interaction.interactionId, 'website-a', 'session-a', result),
    ).toBe(true);
    await expect(promise).resolves.toEqual(result);
    expect(broker.listPending('website-a', 'session-a')).toHaveLength(0);
  });

  it('resolves option responses and removes the pending interaction', async () => {
    const requested = vi.fn();
    const broker = new HumanInteractionBroker(requested);
    const promise = broker.requestQuestion(base);
    const interaction = requested.mock.calls[0]?.[0];
    expect(interaction).toBeDefined();
    expect(broker.listPending('website-a', 'session-a')).toHaveLength(1);
    expect(
      broker.respond(interaction.interactionId, 'website-a', 'session-a', {
        type: 'option',
        optionIndex: 0,
      }),
    ).toBe(true);
    await expect(promise).resolves.toEqual({ type: 'option', optionIndex: 0 });
    expect(broker.listPending('website-a', 'session-a')).toHaveLength(0);
    expect(
      broker.respond(interaction.interactionId, 'website-a', 'session-a', {
        type: 'option',
        optionIndex: 0,
      }),
    ).toBe(false);
  });

  it('resolves custom responses and rejects the wrong session', async () => {
    const requested = vi.fn();
    const broker = new HumanInteractionBroker(requested);
    const promise = broker.requestQuestion(base);
    const interaction = requested.mock.calls[0]?.[0];
    expect(
      broker.respond(interaction.interactionId, 'website-b', 'session-a', {
        type: 'custom',
        value: 'Editorial',
      }),
    ).toBe(false);
    expect(
      broker.respond(interaction.interactionId, 'website-a', 'session-a', {
        type: 'custom',
        value: 'Editorial',
      }),
    ).toBe(true);
    await expect(promise).resolves.toEqual({ type: 'custom', value: 'Editorial' });
  });

  it('cancels on request and AbortSignal and cleans the registry', async () => {
    const requested = vi.fn();
    const broker = new HumanInteractionBroker(requested);
    const promise = broker.requestQuestion(base);
    const interaction = requested.mock.calls[0]?.[0];
    expect(broker.cancel(interaction.interactionId, 'website-a', 'session-a')).toBe(true);
    await expect(promise).resolves.toEqual({ type: 'cancelled' });

    const controller = new AbortController();
    const aborted = broker.requestQuestion(base, controller.signal);
    const second = requested.mock.calls[1]?.[0];
    controller.abort();
    await expect(aborted).resolves.toEqual({ type: 'cancelled' });
    expect(broker.listPending('website-a', 'session-a')).toHaveLength(0);
    expect(broker.cancel(second.interactionId)).toBe(false);
  });

  it('rejects invalid option and empty custom responses without consuming the interaction', () => {
    const requested = vi.fn();
    const broker = new HumanInteractionBroker(requested);
    broker.requestQuestion(base);
    const interaction = requested.mock.calls[0]?.[0];
    expect(
      broker.respond(interaction.interactionId, 'website-a', 'session-a', {
        type: 'option',
        optionIndex: 4,
      }),
    ).toBe(false);
    expect(
      broker.respond(interaction.interactionId, 'website-a', 'session-a', {
        type: 'custom',
        value: ' ',
      }),
    ).toBe(false);
    expect(broker.listPending('website-a', 'session-a')).toHaveLength(1);
    broker.cancel(interaction.interactionId);
  });
});
