export function formatMetric(value: number | null | undefined, unit: string) {
  return value == null
    ? 'ยังไม่มีข้อมูล'
    : `${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
}
export function formatDocumentAmount(value: string) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) return 'ยังไม่มีข้อมูล';
  const [whole, decimal = '00'] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimal.padEnd(2, '0')} บาท`;
}
export function bangkokPeriod(start: string, end: string) {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return {
    from: `${start}T00:00:00+07:00`,
    to: `${date.toISOString().slice(0, 10)}T00:00:00+07:00`,
  };
}
export function analyticsDate(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'ยังไม่มีข้อมูล';
}
/** Quote cells and prevent spreadsheet formula execution from user-supplied names. */
export function csvCell(value: string | null) {
  const text = value ?? '';
  return `"${(/^[\s\uFEFF]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
}
