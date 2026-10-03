export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '-';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} วิ`;
  return `${(ms / 60_000).toFixed(1)} นาที`;
}
