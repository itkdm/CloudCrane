export const PBOOT_AUTHORIZATION_URL = 'https://www.pbootcms.com/freesn/';

type ClipboardNavigator = {
  clipboard?: { writeText(value: string): Promise<void> };
};

export async function copyTextWithFallback(value: string): Promise<boolean> {
  const clipboard = (globalThis as typeof globalThis & { navigator?: ClipboardNavigator }).navigator
    ?.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy browser path.
    }
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
}
