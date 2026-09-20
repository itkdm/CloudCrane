/** Next.js server bootstrap; tracing remains optional and never gates startup. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { loadTracingConfig, startObservability } = await import('@cloudcrane/shared');
  startObservability(loadTracingConfig('web'));
}
