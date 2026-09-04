import { describe, expect, it } from 'vitest';
import { formatToolDetail } from './tool-detail-formatter';

describe('formatToolDetail', () => {
  it('pretty prints valid JSON and removes internal fields', () => {
    expect(formatToolDetail('{"url":"/","runId":"secret"}')).toBe(`{
  "url": "/"
}`);
  });

  it('formats truncated JSON-like objects without inventing closing braces', () => {
    expect(formatToolDetail('{"url":"x","viewport":{"width":1440')).toBe(`{
  "url": "x",
  "viewport": {
    "width": 1440`);
  });

  it('preserves punctuation inside strings and plain shell output', () => {
    expect(formatToolDetail('{"title":"a,b:c {x}"')).toContain('"title": "a,b:c {x}"');
    expect(formatToolDetail('ls: cannot access "/tmp/a": No such file')).toBe(
      'ls: cannot access "/tmp/a": No such file',
    );
  });

  it('removes quoted internal fields from truncated JSON objects', () => {
    const result = formatToolDetail('{"url":"/","runId":"secret","viewport":{"width":1440');
    expect(result).not.toContain('runId');
    expect(result).not.toContain('secret');
    expect(result).toContain('"url": "/"');
    expect(result).toContain('"viewport":');
  });

  it('removes multiple internal fields from truncated JSON', () => {
    const result = formatToolDetail(
      '{"url":"/","traceId":"t1","turnIndex":3,"agent_service":"internal","dom":[',
    );
    expect(result).not.toMatch(/traceId|t1|turnIndex|agent_service|internal/);
    expect(result).toContain('url');
    expect(result).toContain('dom');
  });

  it('removes internal fields from truncated arrays while retaining refs', () => {
    const result = formatToolDetail('[{"ref":"e1","runId":"secret"},{"ref":"e2"');
    expect(result).not.toContain('runId');
    expect(result).not.toContain('secret');
    expect(result).toContain('e1');
    expect(result).toContain('e2');
  });

  it('does not remove internal words from JSON string content', () => {
    const result = formatToolDetail(
      '{"message":"runId should remain in this sentence","url":"/"',
    );
    expect(result).toContain('runId should remain in this sentence');
  });

  it('removes internal fields from human-readable lines', () => {
    expect(formatToolDetail('runId: secret\nresult: ok')).toBe('result: ok');
  });

  it('keeps shell error output unchanged', () => {
    expect(formatToolDetail("ls: cannot access '/tmp/a': No such file\n--- exit: 2")).toBe(
      "ls: cannot access '/tmp/a': No such file\n--- exit: 2",
    );
  });

  it('keeps the full available formatted output beyond 1200 characters', () => {
    const tail = 'tail-content-that-must-remain';
    const output = `${'x'.repeat(1300)}${tail}`;
    const result = formatToolDetail(output);
    expect(result.length).toBeGreaterThan(1200);
    expect(result.endsWith(tail)).toBe(true);
  });
});
