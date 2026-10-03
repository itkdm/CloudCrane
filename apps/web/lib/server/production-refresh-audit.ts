export async function finalizeProductionRefreshAuditSafely(
  finalize: () => Promise<void>,
  reportFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await finalize();
  } catch (error) {
    reportFailure(error);
  }
}
