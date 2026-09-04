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
  return text.startsWith('[') && (text.length === 1 || '[{"0123456789-'.includes(text.charAt(1)));
}

function sanitizeDetail(text: string): string {
  return stripJsonLikeInternalFields(text)
    .replace(
      /(^|\n)(\s*)(?:agent\s*service|agent_service|agentservice|runId|traceId|turnIndex)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n]*)/gi,
      '$1',
    )
    .trim();
}

function stripJsonLikeInternalFields(text: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < text.length) {
    const keyStart = text.indexOf('"', cursor);
    if (keyStart < 0) return result + text.slice(cursor);
    result += text.slice(cursor, keyStart);
    const keyEnd = readStringEnd(text, keyStart);
    if (keyEnd < 0) return result + text.slice(keyStart);
    const key = text.slice(keyStart + 1, keyEnd);
    let colon = keyEnd + 1;
    while (/\s/.test(text.charAt(colon))) colon += 1;
    if (text.charAt(colon) !== ':' || !isInternalField(key)) {
      result += text.slice(keyStart, keyEnd + 1);
      cursor = keyEnd + 1;
      continue;
    }
    let valueStart = colon + 1;
    while (/\s/.test(text.charAt(valueStart))) valueStart += 1;
    const valueEnd = readValueEnd(text, valueStart);
    let removeEnd = valueEnd;
    while (/\s/.test(text.charAt(removeEnd))) removeEnd += 1;
    if (text.charAt(removeEnd) === ',') removeEnd += 1;
    else if (text.charAt(removeEnd) === '}' || text.charAt(removeEnd) === ']') {
      const previous = result.trimEnd();
      if (previous.endsWith(',')) result = previous.slice(0, -1);
    }
    cursor = removeEnd;
  }
  return result;
}

function isInternalField(key: string): boolean {
  return /^(agentservice|agent_service|agent service|runid|traceid|turnindex)$/i.test(key);
}

function readStringEnd(text: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') return index;
  }
  return -1;
}

function readValueEnd(text: string, start: number): number {
  if (text.charAt(start) === '"') {
    const end = readStringEnd(text, start);
    return end < 0 ? text.length : end + 1;
  }
  const opening = text.charAt(start);
  if (opening === '{' || opening === '[') {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text.charAt(index);
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === opening) depth += 1;
      else if (char === (opening === '{' ? '}' : ']')) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
    return text.length;
  }
  const nextComma = text.indexOf(',', start);
  const nextObjectEnd = text.indexOf('}', start);
  const nextArrayEnd = text.indexOf(']', start);
  return [nextComma, nextObjectEnd, nextArrayEnd]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? text.length;
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
