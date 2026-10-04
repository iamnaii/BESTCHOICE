import { Decimal } from '@prisma/client/runtime/library';

/** บัญชีที่ยอดปกติอยู่ฝั่งเครดิต (`glContractBalance` ด้าน 'cr') */
const CREDIT_NORMAL = new Set([
  '11-2102',
  '11-2106',
  '21-1103',
  '21-2101',
  '21-2102',
  '21-5101',
  '41-1101',
]);

/**
 * จำลอง `journalLine.findMany` ที่ `glContractBalance` เรียก (เทส jest) — คืนบรรทัดเดียวต่อบัญชีตามยอดที่ให้
 * (ยอดบวก = ฝั่งปกติของบัญชี · ติดลบ = อีกฝั่ง) · บัญชีที่ไม่ระบุ = ไม่มีบรรทัด (ยอด 0).
 * ใช้: `journalLine: { findMany: jest.fn(ledgerLines({ '11-2101': '17000.00' })) }`
 */
export function ledgerLines(balances: Record<string, string>) {
  return async (args: { where: { accountCode: string } }) => {
    const v = balances[args.where.accountCode];
    if (v === undefined) return [];
    const amount = new Decimal(v);
    const creditNormal = CREDIT_NORMAL.has(args.where.accountCode);
    const onCredit = amount.isNegative() ? !creditNormal : creditNormal;
    return [
      {
        debit: onCredit ? new Decimal(0) : amount.abs(),
        credit: onCredit ? amount.abs() : new Decimal(0),
      },
    ];
  };
}
