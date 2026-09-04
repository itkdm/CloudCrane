export function formatToolDetail(text = ''): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(stripInternalFields(JSON.parse(trimmed)), null, 2);
  } catch {
    const sanitized = sanitizeDetail(trimmed);
    return looksJsonLike(sanitized) ? prettyJsonLike(sanitized) : sanitized;
  }
}

function looksJsonLike(text: string): boolean {
  if (text.startsWith('{')) return /"[^"\n]+"\s*:/.test(text);
  return text.startsWith('[') && (text.length === 1 || '[{"0123456789-'.includes(text[1]));
}

function sanitizeDetail(text: string): string {
  return text
    .replace(/(?:agent\s*service|runId|traceId|turnIndex)\s*[:=]\s*[^,\s}]+,?/gi, '')
    .trim();
}

function prettyJsonLike(text: string): string {
  let result = '';
  let indent = 0;
  let inString = false;
  let escaped = false;
  const addIndent = () => {
    result += '  '.repeat(indent);
  };
  for (const char of text) {
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (char === '{' || char === '[') {
      result += char + '\n';
      indent += 1;
      addIndent();
    } else if (char === '}' || char === ']') {
      result = result.trimEnd() + '\n';
      indent = Math.max(0, indent - 1);
      addIndent();
      result += char;
    } else if (char === ',') {
      result = result.trimEnd() + ',\n';
      addIndent();
    } else if (char === ':') {
      result = result.trimEnd() + ': ';
    } else result += char;
  }
  return result.trim();
}

function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/^(agentservice|agent_service|runid|traceid|turnindex)$/i.test(key))
      .map(([key, child]) => [key, stripInternalFields(child)]),
  );
}
