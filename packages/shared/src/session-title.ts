const CHINESE_TITLE_LIMIT = 24;
const ENGLISH_TITLE_LIMIT = 56;

const commonPrefixPattern =
  /^(?:请你|请|帮我|麻烦你|麻烦|能否|可以帮我|please|could you|can you)\s*/i;

/**
 * Derive a stable, human-readable title without another model call.
 * Keep this pure so the server and the Web optimistic projection share it.
 */
export function deriveSessionTitle(firstPrompt: string): string {
  const normalized = normalizePrompt(firstPrompt);
  if (!normalized) return '新对话';

  const semanticTitle = deriveSemanticTitle(normalized);
  if (semanticTitle) return semanticTitle;

  const firstClause = stripCommonPrefix(splitFirstClause(normalized));
  const candidate = firstClause || stripCommonPrefix(normalized);
  if (!candidate) return '新对话';

  return truncateTitle(
    candidate,
    containsChinese(candidate) ? CHINESE_TITLE_LIMIT : ENGLISH_TITLE_LIMIT,
  );
}

function normalizePrompt(value: string): string {
  return value
    .replace(/[`*_>#~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitFirstClause(value: string): string {
  return value.split(/[。！？!?；;\n]/, 1)[0]?.trim() ?? '';
}

function stripCommonPrefix(value: string): string {
  return value.replace(commonPrefixPattern, '').trim();
}

function deriveSemanticTitle(value: string): string | undefined {
  const hasChangeVerb = /改|修改|更改|设置|调整|换成|变成|update|change|set|改成/i.test(value);
  if (hasChangeVerb && /首页/.test(value) && /标题/.test(value)) return '修改首页标题';
  if (hasChangeVerb && /首页/.test(value) && /按钮/.test(value)) return '修改首页按钮';
  if (hasChangeVerb && /标题|title/i.test(value)) return '修改页面标题';
  if (hasChangeVerb && /按钮|button/i.test(value)) return '修改页面按钮';
  return undefined;
}

function truncateTitle(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : value;
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
