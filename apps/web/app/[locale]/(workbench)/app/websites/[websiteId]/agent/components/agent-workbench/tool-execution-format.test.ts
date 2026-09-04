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
});
