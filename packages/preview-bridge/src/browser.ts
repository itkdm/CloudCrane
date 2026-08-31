const BRIDGE_VERSION = 'cloudcrane.preview.v1';
const PREVIEW_CAPABILITIES = [
  'DOM_SNAPSHOT',
  'VISIBLE_TEXT',
  'CONSOLE',
  'WINDOW_ERRORS',
  'VIEWPORT',
  'CURRENT_URL',
];
const MAX_DOM_NODES = 300;
const MAX_DOM_DEPTH = 8;
const MAX_DOM_CHARS = 32_000;
const MAX_VISIBLE_TEXT_CHARS = 32_000;
const MAX_CONSOLE_ENTRIES = 40;
const MAX_CONSOLE_MESSAGE_CHARS = 2_048;
const MAX_ATTRIBUTE_CHARS = 256;
const semanticTags = new Set([
  'main',
  'header',
  'nav',
  'section',
  'article',
  'aside',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'button',
  'img',
  'form',
  'input',
  'textarea',
  'select',
  'label',
  'table',
  'ul',
  'ol',
  'li',
]);
const attributeNames = [
  'id',
  'class',
  'role',
  'aria-label',
  'aria-expanded',
  'aria-selected',
  'href',
  'src',
  'alt',
  'name',
  'type',
  'placeholder',
  'disabled',
  'checked',
];
const sensitiveQueryNames = /^(token|secret|password|passwd|api[_-]?key|access[_-]?token|code)$/i;

type ConsoleEntry = { level: 'error' | 'warn'; message: string; timestamp: string };
type DomNode = {
  ref: string;
  tag: string;
  attributes: Record<string, string>;
  text?: string;
  children: DomNode[];
};

function installPreviewBridge(): void {
  const script = document.currentScript;
  const parentOrigin =
    script instanceof HTMLScriptElement ? script.dataset.cloudcraneParentOrigin : undefined;
  if (!parentOrigin || !isOrigin(parentOrigin)) return;

  const consoleErrors: ConsoleEntry[] = [];
  const windowErrors: ConsoleEntry[] = [];
  patchConsole(consoleErrors);
  window.addEventListener('error', (event) => {
    addRingEntry(windowErrors, 'error', [event.message, event.filename, event.lineno]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    addRingEntry(windowErrors, 'error', ['unhandledrejection', event.reason]);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const message = event.data;
    if (!isObserveRequest(message)) return;
    try {
      post(parentOrigin, {
        version: BRIDGE_VERSION,
        type: 'bridge.observe.response',
        requestId: message.requestId,
        payload: {
          observation: captureObservation(consoleErrors, windowErrors),
        },
      });
    } catch {
      post(parentOrigin, {
        version: BRIDGE_VERSION,
        type: 'bridge.error',
        requestId: message.requestId,
        payload: { code: 'PREVIEW_PROTOCOL_ERROR', message: 'preview observation failed' },
      });
    }
  });
  post(parentOrigin, {
    version: BRIDGE_VERSION,
    type: 'bridge.ready',
    requestId: `bridge:${Date.now()}`,
    payload: { capabilities: PREVIEW_CAPABILITIES },
  });
}

function isOrigin(value: string): boolean {
  try {
    return (
      new URL(value).origin === value &&
      (value.startsWith('http://') || value.startsWith('https://'))
    );
  } catch {
    return false;
  }
}

function isObserveRequest(value: unknown): value is { requestId: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { version?: unknown }).version === BRIDGE_VERSION &&
    (value as { type?: unknown }).type === 'bridge.observe.request' &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    (value as { requestId: string }).requestId.length < 128,
  );
}

function post(parentOrigin: string, message: unknown): void {
  window.parent.postMessage(message, parentOrigin);
}

function captureObservation(consoleErrors: ConsoleEntry[], windowErrors: ConsoleEntry[]) {
  const query = `${location.pathname}${location.search}${location.hash}`;
  return {
    url: location.href.slice(0, 2_048),
    path: query.slice(0, 2_048),
    title: document.title.slice(0, 512),
    viewport: {
      width: Math.max(0, Math.round(window.innerWidth)),
      height: Math.max(0, Math.round(window.innerHeight)),
      devicePixelRatio: Math.min(10, Math.max(0.1, window.devicePixelRatio || 1)),
    },
    scroll: {
      x: Math.max(0, Math.min(10_000_000, window.scrollX || 0)),
      y: Math.max(0, Math.min(10_000_000, window.scrollY || 0)),
    },
    ...captureDom(),
    visibleText: captureVisibleText(),
    consoleErrors: consoleErrors.slice(),
    windowErrors: windowErrors.slice(),
    capturedAt: new Date().toISOString(),
  };
}

function captureDom(): { dom: DomNode[]; domTruncated: boolean } {
  const state = { count: 0, chars: 0, truncated: false, nextRef: 1 };
  const root = document.body;
  if (!root) return { dom: [], domTruncated: false };
  const dom: DomNode[] = [];
  for (const child of Array.from(root.children)) {
    const node = snapshotElement(child, 0, state);
    if (node) dom.push(node);
    if (state.truncated) break;
  }
  return { dom, domTruncated: state.truncated };
}

function snapshotElement(
  element: Element,
  depth: number,
  state: { count: number; chars: number; truncated: boolean; nextRef: number },
): DomNode | null {
  if (state.count >= MAX_DOM_NODES || depth > MAX_DOM_DEPTH || isHidden(element)) {
    state.truncated = true;
    return null;
  }
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const children: DomNode[] = [];
  for (const child of Array.from(element.children)) {
    const node = snapshotElement(child, depth + 1, state);
    if (node) children.push(node);
    if (state.truncated) break;
  }
  const text = directText(element);
  const include = semanticTags.has(tag) || Boolean(role) || children.length > 0;
  if (!include) return children.length ? children[0]! : null;
  const node: DomNode = {
    ref: `e${state.nextRef++}`,
    tag,
    attributes: attributesFor(element),
    children,
  };
  state.count += 1;
  if (text) node.text = text;
  state.chars += JSON.stringify(node).length;
  if (state.chars > MAX_DOM_CHARS) {
    state.truncated = true;
    node.children = [];
  }
  return node;
}

function attributesFor(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const name of attributeNames) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    if (name === 'href' || name === 'src') attributes[name] = sanitizeUrl(value);
    else attributes[name] = value.slice(0, MAX_ATTRIBUTE_CHARS);
  }
  return attributes;
}

function directText(element: Element): string {
  let value = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) value += child.textContent ?? '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 512);
}

function captureVisibleText(): string {
  const root = document.body;
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let result = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (!parent || isHidden(parent) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName))
      continue;
    const text = (current.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const remaining = MAX_VISIBLE_TEXT_CHARS - result.length;
    if (remaining <= 0) break;
    result += `${result ? ' ' : ''}${text.slice(0, remaining)}`;
  }
  return result.slice(0, MAX_VISIBLE_TEXT_CHARS);
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return true;
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value, location.href);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (sensitiveQueryNames.test(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return parsed.href.slice(0, MAX_ATTRIBUTE_CHARS);
  } catch {
    return value.slice(0, MAX_ATTRIBUTE_CHARS);
  }
}

function patchConsole(entries: ConsoleEntry[]): void {
  for (const level of ['error', 'warn'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      addRingEntry(entries, level, args);
      original.apply(console, args);
    };
  }
}

function addRingEntry(entries: ConsoleEntry[], level: 'error' | 'warn', values: unknown[]): void {
  const message = redact(values.map(stringify).join(' ')).slice(0, MAX_CONSOLE_MESSAGE_CHARS);
  entries.push({ level, message, timestamp: new Date().toISOString() });
  while (entries.length > MAX_CONSOLE_ENTRIES) entries.shift();
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redact(value: string): string {
  return value.replace(
    /(token|secret|password|passwd|api[_-]?key|access[_-]?token|authorization)(\s*[:=]\s*)(["']?)[^\s,"'}]+\3/gi,
    '$1$2$3[redacted]$3',
  );
}

installPreviewBridge();
