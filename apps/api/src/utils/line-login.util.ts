/**
 * Build browser-friendly URL that uses LINE Login OAuth.
 * Works outside LINE app — redirects through LINE Login → back to LIFF page.
 */
export function buildBrowserUrl(path: string): string {
  const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
  return `${apiBase}/api/line-oa/line-login/authorize?returnPath=${encodeURIComponent(path)}`;
}
