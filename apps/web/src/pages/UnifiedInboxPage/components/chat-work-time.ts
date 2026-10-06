/** HTML datetime-local values are explicitly Bangkok time, independent of the browser timezone. */
export function bangkokInput(value?: string | null): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Date(new Date(value).getTime() + 7 * 3600_000).toISOString().slice(0, 16);
}
export function bangkokInstant(value: string): string {
  return new Date(`${value}+07:00`).toISOString();
}
