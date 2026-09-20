import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopTendersReportService, bkkDayRange } from './shop-tenders-report.service';

const D = (v: number | string) => new Prisma.Decimal(v);
const at = (hhmm: string) => new Date(`2026-09-20T${hhmm}:00+07:00`);

const row = (o: Record<string, unknown>) => ({
  id: 'x', direction: 'IN', kind: 'CASH_SALE', branchId: 'b1', method: 'CASH', amount: D(0), reference: null,
  actorId: 'u-som', occurredAt: at('10:00'), seq: 1, seqTotal: 1, saleId: null, contractId: null, bookingId: null, tradeInId: null,
  actor: { id: 'u-som', name: 'สมหญิง' }, branch: { id: 'b1', name: 'ลาดพร้าว' },
  sale: null, contract: null, booking: null, tradeIn: null, ...o,
});

// ตัวอย่างเดียวกับ mockup กระดาน 1 + บิลจ่ายผสมของกระดาน 5
const DAY = [
  row({ id: 't1', kind: 'CONTRACT_DOWN', amount: D(3000), occurredAt: at('10:12'), contractId: 'c143',
    contract: { contractNumber: 'BCP-2026-0143', customer: { name: 'ลูกค้า ก' } } }),
  row({ id: 't2', kind: 'CASH_SALE', amount: D(5000), occurredAt: at('10:40'), seq: 1, seqTotal: 2, saleId: 's21',
    sale: { saleNumber: 'SL-260920-0021', customer: { name: 'ลูกค้า ข' } } }),
  row({ id: 't3', kind: 'CASH_SALE', method: 'BANK_TRANSFER', reference: '014820931177', amount: D(4900), occurredAt: at('10:40'),
    seq: 2, seqTotal: 2, saleId: 's21', sale: { saleNumber: 'SL-260920-0021', customer: { name: 'ลูกค้า ข' } } }),
  row({ id: 't4', kind: 'EXTERNAL_FINANCE_DOWN', method: 'QR_EWALLET', reference: 'QR5569012044', amount: D(2500), occurredAt: at('13:05'),
    actorId: 'u-tana', actor: { id: 'u-tana', name: 'ธนา' }, saleId: 's22', sale: { saleNumber: 'SL-260920-0022', customer: { name: 'ลูกค้า ค' } } }),
  row({ id: 't5', direction: 'OUT', kind: 'TRADE_IN_PAYOUT', amount: D(4500), occurredAt: at('14:30'),
    actorId: 'u-tana', actor: { id: 'u-tana', name: 'ธนา' }, tradeInId: 'ti12',
    tradeIn: { voucherNumber: 'EXP-20260900012', sellerName: 'ผู้ขาย ง', customer: null } }),
  row({ id: 't6', kind: 'CONTRACT_DOWN', method: 'BANK_TRANSFER', reference: '014820931177', amount: D(5000), occurredAt: at('15:10'),
    contractId: 'c144', contract: { contractNumber: 'BCP-2026-0144', customer: { name: 'ลูกค้า จ' } } }),
];

function build(rows = DAY, dupes: unknown[] = []) {
  const prisma = {
    shopTender: {
      findMany: jest.fn()
        .mockResolvedValueOnce(rows) // รายการของวัน
        .mockResolvedValueOnce(dupes), // แถวอื่น (ทุกวัน) ที่ใช้เลขอ้างอิงเดียวกัน
    },
    branch: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'ลาดพร้าว' }]) },
  };
  return { service: new ShopTendersReportService(prisma as never), prisma };
}

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null };

describe('bkkDayRange', () => {
  it('cuts the day at Asia/Bangkok midnight, not server-local midnight', () => {
    const { start, end } = bkkDayRange('2026-09-20');
    expect(start.toISOString()).toBe('2026-09-19T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-20T17:00:00.000Z');
  });
  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => bkkDayRange('20/09/2026')).toThrow(BadRequestException);
    expect(() => bkkDayRange('2026-13-40')).toThrow(BadRequestException);
  });
});

describe('ShopTendersReportService.getDailySummary', () => {
  it('totals money in/out per method and derives the cash that must be in the drawer', async () => {
    const { service } = build();
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.totals).toMatchObject({
      cashIn: '8000.00', transferIn: '9900.00', qrIn: '2500.00',
      cashOut: '4500.00', nonCashOut: '0.00',
      expectedCashInDrawer: '3500.00', // 8,000 − 4,500
      inCount: 5, outCount: 1,
    });
  });

  it('groups by staff using the recorded receiver/payer, with net cash per person', async () => {
    const { service } = build();
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.byStaff).toEqual([
      expect.objectContaining({ actorId: 'u-som', name: 'สมหญิง', cashIn: '8000.00', transferIn: '9900.00', qrIn: '0.00', cashOut: '0.00', netCash: '8000.00', count: 4 }),
      expect.objectContaining({ actorId: 'u-tana', name: 'ธนา', cashIn: '0.00', qrIn: '2500.00', cashOut: '4500.00', netCash: '-4500.00', count: 2 }),
    ]);
  });

  it('groups by kind and shows a split bill as one row per tender (จ่ายผสม 1/2, 2/2)', async () => {
    const { service } = build();
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.byKind.find((k) => k.kind === 'CASH_SALE')).toMatchObject({ direction: 'IN', cash: '5000.00', transfer: '4900.00', total: '9900.00', count: 2 });
    const split = r.rows.filter((x) => x.docNumber === 'SL-260920-0021');
    expect(split.map((x) => [x.method, x.amount, x.seq, x.seqTotal])).toEqual([['CASH', '5000.00', 1, 2], ['BANK_TRANSFER', '4900.00', 2, 2]]);
    expect(r.rows.map((x) => x.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']); // เรียงตามเวลา แล้ว seq
    expect(r.rows[4]).toMatchObject({ docType: 'tradeIn', docNumber: 'EXP-20260900012', customerName: 'ผู้ขาย ง', direction: 'OUT' });
  });

  it('flags a transfer reference used on two different documents — same day', async () => {
    const { service } = build();
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.rows.filter((x) => x.duplicateReference).map((x) => x.id)).toEqual(['t3', 't6']);
    expect(r.duplicateReferences).toEqual([
      { reference: '014820931177', documents: expect.arrayContaining(['SL-260920-0021', 'BCP-2026-0144']) },
    ]);
  });

  it('flags a reference that was already used on another day (slip reuse)', async () => {
    const only = [DAY[3]]; // QR5569012044
    const { service, prisma } = build(only, [
      { reference: 'qr5569012044 ', saleId: 's-old', contractId: null, bookingId: null,
        sale: { saleNumber: 'SL-260901-0003' }, contract: null, booking: null },
    ]);
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.rows[0].duplicateReference).toBe(true);
    expect(r.duplicateReferences[0].documents).toEqual(expect.arrayContaining(['SL-260920-0022', 'SL-260901-0003']));
    // ค้นแถวอื่นด้วยเลขอ้างอิงแบบไม่สนตัวพิมพ์ และไม่จำกัดวัน
    const dupeQuery = prisma.shopTender.findMany.mock.calls[1][0];
    expect(dupeQuery.where).toMatchObject({ direction: 'IN', method: { not: 'CASH' } });
    expect(dupeQuery.where.occurredAt).toBeUndefined();
  });

  it('does not flag one reference shared by two tenders of the SAME document', async () => {
    const same = [
      row({ id: 'a', method: 'BANK_TRANSFER', reference: 'TR-000001', amount: D(1), saleId: 's1', seq: 1, seqTotal: 2, sale: { saleNumber: 'SL-1', customer: null } }),
      row({ id: 'b', method: 'QR_EWALLET', reference: 'TR-000001', amount: D(2), saleId: 's1', seq: 2, seqTotal: 2, sale: { saleNumber: 'SL-1', customer: null } }),
    ];
    const { service } = build(same);
    const r = await service.getDailySummary({ date: '2026-09-20' }, OWNER);
    expect(r.duplicateReferences).toEqual([]);
  });

  describe('who can see what', () => {
    const where = (prisma: { shopTender: { findMany: jest.Mock } }) => prisma.shopTender.findMany.mock.calls[0][0].where;

    it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s sees every branch, or one branch when asked', async (role) => {
      const a = build();
      await a.service.getDailySummary({ date: '2026-09-20' }, { id: 'u', role, branchId: null });
      expect(where(a.prisma).branchId).toBeUndefined();
      expect(where(a.prisma).actorId).toBeUndefined();
      const b = build();
      await b.service.getDailySummary({ date: '2026-09-20', branchId: 'b2' }, { id: 'u', role, branchId: null });
      expect(where(b.prisma).branchId).toBe('b2');
    });

    it('BRANCH_MANAGER is pinned to their own branch — another branchId is refused, no branch = fail-closed', async () => {
      const a = build();
      await a.service.getDailySummary({ date: '2026-09-20' }, { id: 'bm', role: 'BRANCH_MANAGER', branchId: 'b1' });
      expect(where(a.prisma)).toMatchObject({ branchId: 'b1' });
      expect(where(a.prisma).actorId).toBeUndefined();
      await expect(build().service.getDailySummary({ date: '2026-09-20', branchId: 'b2' }, { id: 'bm', role: 'BRANCH_MANAGER', branchId: 'b1' }))
        .rejects.toThrow(ForbiddenException);
      await expect(build().service.getDailySummary({ date: '2026-09-20' }, { id: 'bm', role: 'BRANCH_MANAGER', branchId: null }))
        .rejects.toThrow(ForbiddenException);
    });

    it('SALES sees only the rows they received or paid themselves', async () => {
      const a = build();
      const r = await a.service.getDailySummary({ date: '2026-09-20', branchId: 'b9' }, { id: 'u-tana', role: 'SALES', branchId: 'b1' });
      expect(where(a.prisma)).toMatchObject({ actorId: 'u-tana' });
      expect(where(a.prisma).branchId).toBeUndefined(); // branchId ที่ขอมาถูกละเลย — ขอบเขตคือ "ของตัวเอง"
      expect(r.scope).toBe('OWN');
    });
  });
});
