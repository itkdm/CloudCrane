import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ pinnedLookupResult: undefined as unknown }));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
}));

vi.mock('node:https', () => ({
  request: vi.fn((_url, options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const response = Object.assign(Readable.from([]), {
        statusCode: 302,
        statusMessage: 'Found',
        rawHeaders: ['location', 'https://internal.example/admin'],
      });
      const lookupCallback = options.lookup;
      lookupCallback('llm.example.com', {}, (...result: unknown[]) => {
        mockState.pinnedLookupResult = result;
      });
      onResponse(response);
    };
    return request;
  }),
}));

import { createSecureProviderFetch } from './secure-provider-fetch.js';

describe('secure provider fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.pinnedLookupResult = undefined;
  });

  it('pins a public DNS result and returns redirects without following them', async () => {
    const fetch = createSecureProviderFetch('https://llm.example.com/v1');
    const response = await fetch('https://llm.example.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(302);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('llm.example.com', { all: true, verbatim: true });
    expect(mockState.pinnedLookupResult).toEqual([null, '8.8.8.8', 4]);
  });

  it('rejects private DNS results before opening a connection', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.20.0.4', family: 4 }] as never);
    const fetch = createSecureProviderFetch('https://llm.example.com/v1');

    await expect(
      fetch('https://llm.example.com/v1/chat/completions', { method: 'POST', body: '{}' }),
    ).rejects.toThrow('public addresses');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rejects requests outside the configured host before DNS or connection', async () => {
    const fetch = createSecureProviderFetch('https://llm.example.com/v1');

    await expect(fetch('https://127.0.0.1/v1/chat/completions')).rejects.toThrow(
      'outside the configured HTTPS endpoint',
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});
