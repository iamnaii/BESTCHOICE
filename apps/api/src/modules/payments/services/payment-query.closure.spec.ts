import { Prisma } from '@prisma/client';
import { PaymentQueryService } from './payment-query.service';

/**
 * เจ้าของ 2026-09-24: "ไม่มีประวัติว่าลูกค้าปิดยอด / คืนเครื่อง" — หน้า "ประวัติการชำระ"
 * เรียงจากใบเสร็จ แต่คืนเครื่อง/ยึดคืน (JP5) ไม่ออกใบเสร็จ. `contract.closure` ของ
 * GET /payments/contract/:id คือแหล่งเดียวที่หน้านั้นใช้วาดแถว "ปิดสัญญาแล้ว".
 */
describe('PaymentQueryService.getContractPayments — contract.closure', () => {
  const dec = (v: string) => new Prisma.Decimal(v);
  const at = (iso: string) => new Date(iso);

  function build(overrides: {
    status?: string;
    repossession?: unknown;
    receipt?: unknown;
    entryNumber?: string | null;
    users?: Record<string, string>;
  }) {
    const contract = {
      id: 'ct-1',
      contractNumber: 'TEST-20260827-019',
      status: overrides.status ?? 'ACTIVE',
      deletedAt: null,
      updatedAt: at('2026-09-22T20:25:08.868Z'),
      totalMonths: 12,
      advanceBalance: dec('0'),
      rescheduleAdvanceBalance: dec('0'),
      customer: { name: 'ทดสอบ' },
      product: { brand: 'Apple', model: 'iPhone 15' },
    };
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      repossession: { findFirst: jest.fn().mockResolvedValue(overrides.repossession ?? null) },
      receipt: { findFirst: jest.fn().mockResolvedValue(overrides.receipt ?? null) },
      journalEntry: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.entryNumber === undefined || overrides.entryNumber === null
              ? null
              : { entryNumber: overrides.entryNumber },
          ),
      },
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              overrides.users?.[where.id] ? { name: overrides.users[where.id] } : null,
            ),
          ),
      },
    };
    return { service: new PaymentQueryService(prisma as any), prisma };
  }

  it('สัญญายังเดินอยู่ → closure null และไม่แตะตารางยึด/ใบเสร็จเพิ่มนอกจากด่านแถวยึด', async () => {
    const { service, prisma } = build({ status: 'ACTIVE' });
    const res = await service.getContractPayments('ct-1');
    expect(res.contract.status).toBe('ACTIVE');
    expect(res.contract.closure).toBeNull();
    expect(prisma.receipt.findFirst).not.toHaveBeenCalled();
    expect(prisma.journalEntry.findFirst).not.toHaveBeenCalled();
  });

  it('คืนเครื่อง/ยึดคืน: อ่านจากแถวยึด + ใบรับเครื่องคืน — ยอดปิด ราคาประเมิน เลขใบ ผู้ยืนยัน และ JE JP5', async () => {
    const { service, prisma } = build({
      status: 'CLOSED_BAD_DEBT',
      repossession: {
        repossessedDate: at('2026-09-22T17:00:00.000Z'),
        closingAmount: dec('17717.97'),
        appraisalPrice: dec('17800.00'),
        appraisedBy: { name: 'ผจก.ลพบุรี' },
        deviceReturn: {
          docNumber: 'DR-20260922-0001',
          confirmedAt: at('2026-09-22T20:25:08.000Z'),
          confirmedById: 'u-fm',
        },
      },
      entryNumber: 'JE-202609-00051',
      users: { 'u-fm': 'เอกนรินทร์ คงเดช' },
    });
    const res = await service.getContractPayments('ct-1');
    expect(res.contract.closure).toEqual({
      kind: 'DEVICE_RETURN',
      at: at('2026-09-22T20:25:08.000Z'),
      amount: '17717.97',
      appraisalPrice: '17800',
      docNumber: 'DR-20260922-0001',
      receiptNumber: null,
      entryNumber: 'JE-202609-00051',
      byName: 'เอกนรินทร์ คงเดช',
    });
    // JE ที่หา = flow repossession (JP5) ของสัญญานี้
    const where = prisma.journalEntry.findFirst.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { metadata: { path: ['contractId'], equals: 'ct-1' } },
      { metadata: { path: ['flow'], equals: 'repossession' } },
    ]);
  });

  it('แถวยึดที่ไม่มีใบรับเครื่องคืน (ยึดยุคก่อน 2026-09-20) → ใช้วันยึด + ผู้ประเมินแทน', async () => {
    const { service } = build({
      status: 'CLOSED_BAD_DEBT',
      repossession: {
        repossessedDate: at('2026-08-01T03:00:00.000Z'),
        closingAmount: null,
        appraisalPrice: dec('5000'),
        appraisedBy: { name: 'ผจก.สาขา' },
        deviceReturn: null,
      },
      entryNumber: null,
    });
    const res = await service.getContractPayments('ct-1');
    expect(res.contract.closure).toMatchObject({
      kind: 'DEVICE_RETURN',
      at: at('2026-08-01T03:00:00.000Z'),
      amount: null,
      docNumber: null,
      entryNumber: null,
      byName: 'ผจก.สาขา',
    });
  });

  it('ปิดยอดก่อนกำหนด: อ่านจากใบเสร็จ EARLY_PAYOFF ที่ไม่ถูกยกเลิก + JE JP4', async () => {
    const { service, prisma } = build({
      status: 'EARLY_PAYOFF',
      receipt: {
        receiptNumber: 'RT-202609-00030',
        amount: dec('18135.85'),
        paidDate: at('2026-09-24T05:00:00.000Z'),
        issuedById: 'u-bm',
      },
      entryNumber: 'JE-202609-00060',
      users: { 'u-bm': 'ผจก.ลพบุรี' },
    });
    const res = await service.getContractPayments('ct-1');
    expect(res.contract.closure).toEqual({
      kind: 'EARLY_PAYOFF',
      at: at('2026-09-24T05:00:00.000Z'),
      amount: '18135.85',
      appraisalPrice: null,
      docNumber: null,
      receiptNumber: 'RT-202609-00030',
      entryNumber: 'JE-202609-00060',
      byName: 'ผจก.ลพบุรี',
    });
    expect(prisma.receipt.findFirst.mock.calls[0][0].where).toEqual({
      contractId: 'ct-1',
      receiptType: 'EARLY_PAYOFF',
      isVoided: false,
      deletedAt: null,
    });
  });

  it.each([['COMPLETED'], ['CANCELED']])(
    '%s → closure ชนิดนั้นด้วยเวลาที่สัญญาเปลี่ยนล่าสุด',
    async (status) => {
      const { service } = build({ status });
      const res = await service.getContractPayments('ct-1');
      expect(res.contract.closure).toMatchObject({
        kind: status,
        at: at('2026-09-22T20:25:08.868Z'),
      });
    },
  );
});
