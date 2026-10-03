export function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  // Pin to Asia/Bangkok so server TZ (Cloud Run UTC) doesn't shift the date
  // by 1 day for late-evening BKK timestamps, and render year in Buddhist
  // Era (พ.ศ.) — Thai accounting documents use พ.ศ.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = parseInt(get('year'), 10) + 543;
  return `${get('day')}/${get('month')}/${year}`;
}

export function fmtMoney(v: unknown): string {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatAddress(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const addr = JSON.parse(trimmed) as Record<string, string | undefined>;
    if (typeof addr !== 'object' || addr === null) return trimmed;
    if (addr.raw && !addr.province) return addr.raw;
    const parts: string[] = [];
    if (addr.houseNo) parts.push(`เลขที่ ${addr.houseNo}`);
    if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
    if (addr.village) parts.push(`หมู่บ้าน ${addr.village}`);
    if (addr.soi) parts.push(`ซอย ${addr.soi}`);
    if (addr.road) parts.push(`ถนน ${addr.road}`);
    if (addr.subdistrict) parts.push(`ตำบล${addr.subdistrict}`);
    if (addr.district) parts.push(`อำเภอ${addr.district}`);
    if (addr.province) parts.push(`จังหวัด${addr.province}`);
    if (addr.postalCode) parts.push(addr.postalCode);
    return parts.length > 0 ? parts.join(' ') : trimmed;
  } catch {
    return trimmed;
  }
}
