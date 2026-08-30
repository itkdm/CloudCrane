import path from 'node:path';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID`);
}

export class AgentSessionPathLayout {
  readonly root: string;

  constructor(agentDataRoot: string) {
    this.root = path.resolve(agentDataRoot);
  }

  sessionDirectory(websiteId: string): string {
    assertUuid(websiteId, 'websiteId');
    return path.join(this.root, websiteId, 'agent', 'sessions');
  }

  relativeSessionFile(websiteId: string, absoluteSessionFile: string): string {
    const relative = path.relative(this.root, path.resolve(absoluteSessionFile));
    const normalized = relative.split(path.sep).join('/');
    this.assertRelativeSessionFile(websiteId, normalized);
    return normalized;
  }

  absoluteSessionFile(websiteId: string, relativeSessionFile: string): string {
    this.assertRelativeSessionFile(websiteId, relativeSessionFile);
    const absolute = path.resolve(this.root, relativeSessionFile.split('/').join(path.sep));
    const expectedRoot = path.resolve(this.sessionDirectory(websiteId));
    const relative = path.relative(expectedRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('session file is outside the website session directory');
    return absolute;
  }

  private assertRelativeSessionFile(websiteId: string, value: string): void {
    assertUuid(websiteId, 'websiteId');
    if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value))
      throw new Error('session file must be a safe relative POSIX path');
    const segments = value.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..'))
      throw new Error('session file contains an unsafe path segment');
    const prefix = `${websiteId}/agent/sessions/`;
    if (!value.startsWith(prefix) || value.slice(prefix.length).includes('/'))
      throw new Error('session file must belong to the website session directory');
  }
}
