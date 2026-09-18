const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f172a"/><path d="M17 42 32 13l15 29H36l-4-8-4 8H17Z" fill="#e2e8f0"/><circle cx="32" cy="48" r="4" fill="#38bdf8"/></svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'image/svg+xml',
    },
  });
}
