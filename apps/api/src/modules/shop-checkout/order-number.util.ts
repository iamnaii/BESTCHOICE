export function generateOrderNumber(now = new Date()): string {
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `BC-${y}${m}${d}-${suffix}`;
}
