export function calculatePaymentWatchRisk(input: {
  latePaymentCount: unknown;
  partialPaymentCount: unknown;
  hadDunningReset: unknown;
}) {
  const late = Number(input.latePaymentCount);
  const partial = Number(input.partialPaymentCount);
  const dunningReset = Boolean(input.hadDunningReset);
  const score = Math.min(late, 5) + partial * 2 + (dunningReset ? 3 : 0);
  const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

  const reasons: string[] = [];
  if (late >= 2) reasons.push(`ชำระล่าช้า ${late} ครั้ง`);
  if (partial >= 1) reasons.push(`จ่ายไม่ครบ ${partial} ครั้ง`);
  if (dunningReset) reasons.push('เคยถูกติดตามหนี้แล้ว reset');

  return { late, partial, dunningReset, score, riskLevel, reasons };
}
