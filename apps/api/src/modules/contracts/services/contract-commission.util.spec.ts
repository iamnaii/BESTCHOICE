import { Prisma } from '@prisma/client';
import { clawbackContractCommission, ensureContractCommission } from './contract-commission.util';

const D = (v: number | string) => new Prisma.Decimal(v);
const asTx = (tx: unknown) => tx as Prisma.TransactionClient;

describe('ensureContractCommission — ค่าคอมสัญญาผ่อน สร้างตอนเปิดใช้สัญญา (เจ้าของเคาะ 2026-09-20)', () => {
  const base = { contractId: 'c1', saleId: 's1', salespersonId: 'u-sales', netAmount: D('15000'), now: new Date('2026-09-20T05:00:00Z') };

  it('uses the same rule as a cash sale: active CommissionRule rate × selling price after discount, status PENDING', async () => {
    const tx = {
      salesCommission: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'cm1' }) },
      commissionRule: { findFirst: jest.fn().mockResolvedValue({ rate: D('0.02') }) },
    };
    expect(await ensureContractCommission(asTx(tx), base)).toBe('CREATED');
    expect(tx.commissionRule.findFirst).toHaveBeenCalledWith({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const data = tx.salesCommission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      salespersonId: 'u-sales', snapshotSalespersonId: 'u-sales', contractId: 'c1', saleId: 's1',
      period: '2026-09', commissionRate: 0.02, status: 'PENDING',
    });
    expect(Number(data.saleAmount)).toBe(15000);
    expect(Number(data.commissionAmount)).toBe(300);
  });

  it('falls back to 3% when no rule is active (same fallback as the cash sale)', async () => {
    const tx = {
      salesCommission: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'cm1' }) },
      commissionRule: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await ensureContractCommission(asTx(tx), base);
    expect(Number(tx.salesCommission.create.mock.calls[0][0].data.commissionAmount)).toBe(450);
  });

  it('takes the payout period from the Bangkok calendar, not the server clock', async () => {
    const tx = {
      salesCommission: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'cm1' }) },
      commissionRule: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    // 30 ก.ย. 18:30 UTC = 1 ต.ค. 01:30 เวลาไทย
    await ensureContractCommission(asTx(tx), { ...base, now: new Date('2026-09-30T18:30:00Z') });
    expect(tx.salesCommission.create.mock.calls[0][0].data.period).toBe('2026-10');
  });

  it('never creates a second commission — a contract from the old POS path already has one from draft time', async () => {
    const tx = {
      salesCommission: { findFirst: jest.fn().mockResolvedValue({ id: 'legacy' }), create: jest.fn() },
      commissionRule: { findFirst: jest.fn() },
    };
    expect(await ensureContractCommission(asTx(tx), base)).toBe('EXISTS');
    expect(tx.salesCommission.findFirst).toHaveBeenCalledWith({ where: { contractId: 'c1', deletedAt: null }, select: { id: true } });
    expect(tx.salesCommission.create).not.toHaveBeenCalled();
  });
});

describe('clawbackContractCommission — ยกเลิกสัญญา = เรียกคืนค่าคอมที่ยังไม่จ่าย', () => {
  const now = new Date('2026-09-25T03:00:00Z');
  const commission = (o: Record<string, unknown>) => ({ id: 'cm1', status: 'PENDING', salespersonId: 'u-sales', period: '2026-09',
    createdAt: new Date('2026-09-20T05:00:00Z'), ...o });

  function build(commissions: unknown[], payouts: unknown[] = []) {
    const tx = {
      salesCommission: { findMany: jest.fn().mockResolvedValue(commissions), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      commissionPayout: { findMany: jest.fn().mockResolvedValue(payouts), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    return tx;
  }

  it('claws back PENDING / APPROVED commission in full and stamps why', async () => {
    const tx = build([commission({ id: 'a' }), commission({ id: 'b', status: 'APPROVED' })]);
    const result = await clawbackContractCommission(asTx(tx), { contractId: 'c1', contractNumber: 'BCP-1', reason: 'ลูกค้าเปลี่ยนใจ', now });
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { status: 'CLAWED_BACK', clawbackAt: now, clawbackPercent: 100, clawbackReason: 'ยกเลิกสัญญา BCP-1: ลูกค้าเปลี่ยนใจ' },
    });
    expect(result).toEqual({ clawedBackIds: ['a', 'b'], keptPaidIds: [], voidedDraftPayoutIds: [], lockedPayoutIds: [] });
  });

  it('leaves commission that was already paid alone — the owner chose to recall only unpaid commission', async () => {
    const tx = build([commission({ id: 'paid', status: 'PAID' }), commission({ id: 'open' })]);
    const result = await clawbackContractCommission(asTx(tx), { contractId: 'c1', contractNumber: 'BCP-1', reason: 'x', now });
    expect(tx.salesCommission.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['open'] } });
    expect(result.keptPaidIds).toEqual(['paid']);
  });

  it('soft-deletes a DRAFT payout round that counted this commission so it is regenerated, and reports a locked round', async () => {
    const tx = build([commission({ id: 'a' })], [
      { id: 'p-draft', status: 'DRAFT', salespersonId: 'u-sales', period: '2026-09', generatedAt: new Date('2026-09-22T00:00:00Z') },
      { id: 'p-before', status: 'DRAFT', salespersonId: 'u-sales', period: '2026-09', generatedAt: new Date('2026-09-19T00:00:00Z') }, // สร้างก่อนค่าคอมเกิด = ไม่เคยนับ
      { id: 'p-approved', status: 'APPROVED', salespersonId: 'u-sales', period: '2026-09', generatedAt: null }, // พิสูจน์ไม่ได้ = ถือว่าครอบ
    ]);
    const result = await clawbackContractCommission(asTx(tx), { contractId: 'c1', contractNumber: 'BCP-1', reason: 'x', now });
    expect(tx.commissionPayout.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p-draft'] } }, data: { deletedAt: now } });
    expect(result.voidedDraftPayoutIds).toEqual(['p-draft']);
    expect(result.lockedPayoutIds).toEqual(['p-approved']);
  });

  it('does nothing for a contract that has no commission', async () => {
    const tx = build([]);
    const result = await clawbackContractCommission(asTx(tx), { contractId: 'c1', contractNumber: 'BCP-1', reason: 'x', now });
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
    expect(tx.commissionPayout.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ clawedBackIds: [], keptPaidIds: [], voidedDraftPayoutIds: [], lockedPayoutIds: [] });
  });
});
