import { Prisma } from '@prisma/client';
import { CustomerPurchaseSummaryService } from './customer-purchase-summary.service';
import { PrismaService } from '../../../prisma/prisma.service';

const dec = (v: string | number) => new Prisma.Decimal(v);

type Row = Record<string, unknown>;

/** ตัวกรองที่ fake db รู้จัก — ต้องครอบเท่าที่ service ส่งมาจริง */
function matches(row: Row, where: Record<string, any>): boolean {
  if (where.customerId?.in && !where.customerId.in.includes(row.customerId)) return false;
  if (where.contractId?.in && !where.contractId.in.includes(row.contractId)) return false;
  // 🔴 ถ้า service ลืมส่ง deletedAt: null มา แถวที่ถูกยกเลิกจะผ่านตรงนี้เข้าไป
  if ('deletedAt' in where && where.deletedAt === null && row.deletedAt != null) return false;
  if (where.saleType) {
    const want = typeof where.saleType === 'string' ? [where.saleType] : where.saleType.in;
    if (!want.includes(row.saleType)) return false;
  }
  if (where.status) {
    if (where.status.in && !where.status.in.includes(row.status)) return false;
    if (where.status.not && row.status === where.status.not) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: Array<Record<string, 'asc' | 'desc'>> = []): Row[] {
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, direction] = Object.entries(clause)[0];
      const av = a[field] as never, bv = b[field] as never;
      if (av === bv) continue;
      const delta = av > bv ? 1 : -1;
      return direction === 'asc' ? delta : -delta;
    }
    return 0;
  });
}

function fakeDb(fixtures: { sales: Row[]; contracts: Row[]; payments: Row[] }) {
  const calls: string[] = [];
  const list = (name: string, rows: Row[]) => jest.fn(async (args: any) => {
    calls.push(name);
    let result = rows.filter(row => matches(row, args.where));
    result = sortRows(result, args.orderBy);
    if (args.distinct) {
      const seen = new Set<unknown>();
      result = result.filter(row => {
        const key = args.distinct.map((field: string) => row[field]).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return result;
  });
  const group = (name: string, rows: Row[], by: string[]) => jest.fn(async (args: any) => {
    calls.push(name);
    const buckets = new Map<string, { key: Row; rows: Row[] }>();
    for (const row of rows.filter(candidate => matches(candidate, args.where))) {
      const key = by.map(field => row[field]).join('|');
      const bucket = buckets.get(key) ?? { key: Object.fromEntries(by.map(field => [field, row[field]])), rows: [] };
      bucket.rows.push(row);
      buckets.set(key, bucket);
    }
    return [...buckets.values()].map(bucket => ({
      ...bucket.key,
      _count: { _all: bucket.rows.length },
      _sum: {
        amountDue: bucket.rows.reduce((sum, row) => sum.add(dec((row.amountDue ?? 0) as number)), dec(0)),
        amountPaid: bucket.rows.reduce((sum, row) => sum.add(dec((row.amountPaid ?? 0) as number)), dec(0)),
      },
    }));
  });
  return {
    calls,
    sale: { groupBy: group('sale.groupBy', fixtures.sales, ['customerId', 'saleType']), findMany: list('sale.findMany', fixtures.sales) },
    contract: { groupBy: group('contract.groupBy', fixtures.contracts, ['customerId', 'status']), findMany: list('contract.findMany', fixtures.contracts) },
    payment: { groupBy: group('payment.groupBy', fixtures.payments, ['contractId']), findMany: list('payment.findMany', fixtures.payments) },
  };
}

const device = { brand: 'Apple', model: 'iPhone 15', storage: '256GB', imeiSerial: 'IMEI-1', warrantyExpireDate: null };

describe('CustomerPurchaseSummaryService', () => {
  it('ยิง query คงที่ 7 นัดต่อหน้า 50 คน (ล็อกไว้กันใครเผลอกลับไปอ่านรายแถว)', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `cu${index}`);
    const db = fakeDb({
      sales: ids.map((id, index) => ({ customerId: id, id: `s${index}`, saleNumber: `SA-${index}`, saleType: 'CASH',
        createdAt: new Date('2026-08-01T00:00:00Z'), deletedAt: null, branchId: 'br1', shopWarrantyEndDate: null,
        branch: { id: 'br1', name: 'สาขาหลัก' }, product: device })),
      contracts: ids.map((id, index) => ({ customerId: id, id: `ct${index}`, contractNumber: `BC-${index}`, status: 'ACTIVE',
        createdAt: new Date('2026-09-01T00:00:00Z'), deletedAt: null, branchId: 'br1', deviceReceivedAt: null,
        shopWarrantyEndDate: null, branch: { id: 'br1', name: 'สาขาหลัก' }, product: device })),
      payments: ids.map((id, index) => ({ contractId: `ct${index}`, installmentNo: 1, dueDate: new Date('2026-10-05T00:00:00Z'),
        amountDue: 3200, amountPaid: 0, status: 'PENDING', deletedAt: null })),
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const result = await service.forCustomers(ids, db as unknown as Prisma.TransactionClient);
    expect(result.size).toBe(50);
    expect(db.calls).toHaveLength(7);
    expect(db.calls.sort()).toEqual([
      'contract.findMany', 'contract.findMany', 'contract.groupBy',
      'payment.findMany', 'payment.groupBy',
      'sale.findMany', 'sale.groupBy',
    ]);
  });

  it('ใบขายที่ถูกยกเลิก (soft-deleted) ไม่กลายเป็น "ซื้อล่าสุด" แม้จะใหม่กว่า', async () => {
    const db = fakeDb({
      sales: [
        { customerId: 'cu1', id: 's-void', saleNumber: 'SA-VOID', saleType: 'CASH', createdAt: new Date('2026-09-10T00:00:00Z'),
          deletedAt: new Date('2026-09-11T00:00:00Z'), branchId: 'br1', shopWarrantyEndDate: null,
          branch: { id: 'br1', name: 'สาขาหลัก' }, product: device },
        { customerId: 'cu1', id: 's-live', saleNumber: 'SA-LIVE', saleType: 'CASH', createdAt: new Date('2026-08-01T00:00:00Z'),
          deletedAt: null, branchId: 'br2', shopWarrantyEndDate: null,
          branch: { id: 'br2', name: 'สาขาสอง' }, product: device },
      ],
      contracts: [],
      payments: [],
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const summary = (await service.forCustomers(['cu1'], db as unknown as Prisma.TransactionClient)).get('cu1')!;
    expect(summary.latestPurchase).toMatchObject({ number: 'SA-LIVE', kind: 'CASH', branchName: 'สาขาสอง' });
    expect(summary.purchase.cashCount).toBe(1);
    expect(summary.installmentBalance).toBeNull();
  });

  it('ชิปการซื้อ: DRAFT ไปถัง OTHER และไม่ถูกนับใน "ผ่อน N" (D1)', async () => {
    const base = { customerId: 'cu1', createdAt: new Date('2026-09-01T00:00:00Z'), deletedAt: null, branchId: 'br1',
      deviceReceivedAt: null, shopWarrantyEndDate: null, branch: null, product: device };
    const db = fakeDb({
      sales: [],
      contracts: [
        { ...base, id: 'ct1', contractNumber: 'BC-1', status: 'ACTIVE' },
        { ...base, id: 'ct2', contractNumber: 'BC-2', status: 'OVERDUE' },
        { ...base, id: 'ct3', contractNumber: 'BC-3', status: 'COMPLETED' },
        { ...base, id: 'ct4', contractNumber: 'BC-4', status: 'DRAFT' },
      ],
      payments: [],
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const summary = (await service.forCustomers(['cu1'], db as unknown as Prisma.TransactionClient)).get('cu1')!;
    expect(summary.purchase.installmentTotal).toBe(3);
    expect(summary.purchase.installmentByState).toEqual({ ACTIVE: 1, OVERDUE: 1, CLOSED: 1, BAD_DEBT: 0, OTHER: 1 });
    // สัญญาร่างต้องไม่กลายเป็น "ซื้อล่าสุด"
    expect(summary.latestPurchase!.number).not.toBe('BC-4');
  });

  it('คงค้างใช้เฉพาะงวดที่ยังไม่ปิด และงวดถัดไปคืนยอดของแถวที่ครบกำหนดเร็วที่สุด', async () => {
    const db = fakeDb({
      sales: [],
      contracts: [{ customerId: 'cu1', id: 'ct1', contractNumber: 'BC-1', status: 'ACTIVE',
        createdAt: new Date('2026-05-01T00:00:00Z'), deletedAt: null, branchId: 'br1', deviceReceivedAt: null,
        shopWarrantyEndDate: null, branch: null, product: device }],
      payments: [
        // งวดที่ปิดแล้วด้วยส่วนลด 200 — ต้องไม่ถูกนับเป็นหนี้
        { contractId: 'ct1', installmentNo: 1, dueDate: new Date('2026-06-05T00:00:00Z'), amountDue: 3200, amountPaid: 3000, status: 'PAID', deletedAt: null },
        { contractId: 'ct1', installmentNo: 2, dueDate: new Date('2026-09-25T00:00:00Z'), amountDue: 9600, amountPaid: 0, status: 'OVERDUE', deletedAt: null },
        { contractId: 'ct1', installmentNo: 3, dueDate: new Date('2026-10-25T00:00:00Z'), amountDue: 120.25, amountPaid: 0, status: 'PENDING', deletedAt: null },
      ],
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const summary = (await service.forCustomers(['cu1'], db as unknown as Prisma.TransactionClient)).get('cu1')!;
    expect(summary.installmentBalance).toEqual({
      outstanding: 9720.25,
      nextDueDate: '2026-09-25T00:00:00.000Z',
      nextAmountDue: 9600,   // ไม่ใช่ MIN(amountDue) = 120.25
      openContracts: 1,
    });
  });

  it('สัญญาที่ตัดหนี้สูญ / ยกเลิก ยังรายงานยอดค้าง (สถานะ "ตัดหนี้สูญ X ฿" ของคอลัมน์คงค้าง)', async () => {
    const base = { customerId: 'cu1', createdAt: new Date('2026-03-01T00:00:00Z'), deletedAt: null, branchId: 'br1',
      deviceReceivedAt: null, shopWarrantyEndDate: null, branch: null, product: device };
    const db = fakeDb({
      sales: [],
      contracts: [
        { ...base, id: 'ct-bad', contractNumber: 'BC-BAD', status: 'CLOSED_BAD_DEBT' },
        { ...base, id: 'ct-cancel', contractNumber: 'BC-CANCEL', status: 'CANCELED' },
        // ปิดครบจริง — ต้องไม่ถูกอ่านตารางงวด (ช่องว่าง = ส่วนลดปิดยอด ไม่ใช่หนี้)
        { ...base, id: 'ct-done', contractNumber: 'BC-DONE', status: 'COMPLETED' },
      ],
      payments: [
        { contractId: 'ct-bad', installmentNo: 4, dueDate: new Date('2026-07-05T00:00:00Z'), amountDue: 4000, amountPaid: 0, status: 'OVERDUE', deletedAt: null },
        { contractId: 'ct-bad', installmentNo: 5, dueDate: new Date('2026-08-05T00:00:00Z'), amountDue: 1000, amountPaid: 0, status: 'PENDING', deletedAt: null },
        { contractId: 'ct-cancel', installmentNo: 2, dueDate: new Date('2026-06-05T00:00:00Z'), amountDue: 1200, amountPaid: 0, status: 'OVERDUE', deletedAt: null },
        { contractId: 'ct-done', installmentNo: 1, dueDate: new Date('2026-01-05T00:00:00Z'), amountDue: 9999, amountPaid: 0, status: 'PENDING', deletedAt: null },
      ],
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const summary = (await service.forCustomers(['cu1'], db as unknown as Prisma.TransactionClient)).get('cu1')!;
    expect(summary.purchase.installmentByState).toEqual({ ACTIVE: 0, OVERDUE: 0, CLOSED: 1, BAD_DEBT: 2, OTHER: 0 });
    // 🔴 เดิม installmentBalance เป็น null ⇒ "ตัดหนี้สูญ X ฿" ไม่มีทางขึ้นจอ
    expect(summary.installmentBalance).toEqual({
      outstanding: 6200,                        // 5,000 (ตัดหนี้สูญ) + 1,200 (ยกเลิก) · ไม่มี 9,999 ของ COMPLETED
      nextDueDate: '2026-06-05T00:00:00.000Z',
      nextAmountDue: 1200,
      openContracts: 2,
    });
  });

  it('ประกันถึง = วันที่ไกลกว่าระหว่างประกันร้านกับประกันศูนย์ พร้อมบอกว่ามาจากไหน', async () => {
    const shopEnd = new Date('2026-12-01T00:00:00Z');
    const centerEnd = new Date('2027-06-01T00:00:00Z');
    const db = fakeDb({
      sales: [{ customerId: 'cu1', id: 's1', saleNumber: 'SA-1', saleType: 'EXTERNAL_FINANCE',
        createdAt: new Date('2026-09-01T00:00:00Z'), deletedAt: null, branchId: 'br1', shopWarrantyEndDate: shopEnd,
        branch: null, product: { ...device, warrantyExpireDate: centerEnd } }],
      contracts: [], payments: [],
    });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    const summary = (await service.forCustomers(['cu1'], db as unknown as Prisma.TransactionClient)).get('cu1')!;
    expect(summary.warranty).toMatchObject({
      endDate: centerEnd.toISOString(),
      source: 'CENTER',
      shopEndDate: shopEnd.toISOString(),
      centerEndDate: centerEnd.toISOString(),
    });
    expect(summary.purchase.externalFinanceCount).toBe(1);
  });

  it('ไม่มี id = ไม่ยิง query เลย', async () => {
    const db = fakeDb({ sales: [], contracts: [], payments: [] });
    const service = new CustomerPurchaseSummaryService(db as unknown as PrismaService);
    expect((await service.forCustomers([], db as unknown as Prisma.TransactionClient)).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});
