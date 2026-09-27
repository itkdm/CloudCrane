export type AuthRequestOutcome<T> = { ok: true; value: T } | { ok: false };

export async function captureAuthRequest<T>(
  request: () => Promise<T>,
): Promise<AuthRequestOutcome<T>> {
  try {
    return { ok: true, value: await request() };
  } catch {
    return { ok: false };
  }
}
