import type { JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { creditSource } from './credit.source';
import { saleSource } from './sale.source';

const at = (iso: string) => new Date(iso);
const u1 = { id: 'u1', name: 'แนน' };
const u9 = { id: 'u9', name: 'เจ้าของ' };
const OWNER = { id: 'o1', role: 'OWNER' };
const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);

function creditDb() {
  return {
    creditCheck: { findMany: jest.fn().mockResolvedValue([
      { id: 'cc-shop', createdAt: at('2026-09-01T03:00:00.000Z'), roomAnalysis: null },
      { id: 'cc-chat', createdAt: at('2026-09-02T03:00:00.000Z'), roomAnalysis: { roomId: 'r1' } },
    ]) },
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([{ refId: 'cc-shop', actorUser: u1 }]) },
    roomCreditAnalysis: { findMany: jest.fn().mockResolvedValue([{ id: 'rca1', roomId: 'r1', createdAt: at('2026-09-02T02:00:00.000Z') }]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([{ id: 'al1', createdAt: at('2026-09-03T03:00:00.000Z'), newValue: { status: 'REJECTED', overrideReason: 'เบอร์ 0812345678' }, user: u9 }]) },
    creditApproval: { findMany: jest.fn().mockResolvedValue([{ id: 'ap1', createdAt: at('2026-09-04T03:00:00.000Z'), approvedMonthlyPayment: '4200.00', approvedBy: u9 }]) },
  };
}

describe('creditSource', () => {
  it('OWNER: เปิดตรวจ (ผู้เปิดจาก entry) · สเตทเม้นจากแชท · ผลตัดสิน · วงเงิน — ไม่คัด overrideReason', async () => {
    const events = await creditSource(creditDb() as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events.map((e) => e.id)).toEqual(['creditapproval-ap1', 'creditdecision-al1', 'credit-cc-chat', 'statement-rca1', 'credit-cc-shop']);
    expect(byId(events, 'credit-cc-shop')).toEqual({ id: 'credit-cc-shop', type: 'CREDIT_CHECK_OPENED', group: 'credit', stage: 'CREDIT', timestamp: '2026-09-01T03:00:00.000Z', title: 'เปิดตรวจเครดิต (ที่ร้าน)', actor: { type: 'STAFF', ...u1 }, reliability: 'exact', origin: 'SOURCE' });
    expect(byId(events, 'credit-cc-chat')).toMatchObject({ title: 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)', actor: null, reliability: 'approximate', href: '/inbox/r1' });
    expect(byId(events, 'statement-rca1')).toMatchObject({ type: 'CHAT_STATEMENT_ANALYZED', href: '/inbox/r1' });
    expect(byId(events, 'creditdecision-al1')).toMatchObject({ title: 'ไม่อนุมัติเครดิต', actor: { type: 'STAFF', ...u9 }, metadata: { status: 'REJECTED' } });
    expect(byId(events, 'creditapproval-ap1')).toMatchObject({ title: 'อนุมัติค่างวดไม่เกิน 4,200 บาท/เดือน' });
    expect(JSON.stringify(events)).not.toMatch(/0812345678|overrideReason/);
  });

  it('SALES ใช้ creditHistoryAccess + กติกาห้อง · ACCOUNTANT ไม่ดึงสเตทเม้นและไม่มีลิงก์แชท · ไม่มีผลตรวจ = ไม่ยิงต่อ', async () => {
    const sales = creditDb();
    await creditSource(sales as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, { id: 's1', role: 'SALES' });
    expect(sales.creditCheck.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
    expect(sales.roomCreditAnalysis.findMany.mock.calls[0][0].where.room).toEqual({ is: { customerId: { in: ['c1', 'p1'] }, OR: [{ assignedToId: null }, { assignedToId: 's1' }] } });
    const accountant = creditDb();
    const events = await creditSource(accountant as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'a1', role: 'ACCOUNTANT' });
    expect(accountant.roomCreditAnalysis.findMany).not.toHaveBeenCalled();
    expect(accountant.creditCheck.findMany.mock.calls[0][0].where).toEqual({ customerId: { in: ['c1'] }, deletedAt: null, roomAnalysis: { is: null } });
    expect(events.filter((e) => e.href)).toEqual([]);
    const empty = creditDb();
    empty.creditCheck.findMany.mockResolvedValue([]);
    empty.roomCreditAnalysis.findMany.mockResolvedValue([]);
    await creditSource(empty as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(empty.auditLog.findMany).not.toHaveBeenCalled();
    expect(empty.creditApproval.findMany).not.toHaveBeenCalled();
  });
});

function saleDb() {
  const sale = (o: Record<string, unknown>) => ({ financeCompany: null, contractId: null, saleSource: 'OFFLINE', deletedAt: null, salesperson: u1, voidedBy: null, product: null, netAmount: '30000.00', ...o });
  return {
    booking: { findMany: jest.fn().mockResolvedValue([
      { id: 'b1', bookingNumber: 'BK-1', status: 'CONVERTED', depositAmount: '1000.00', depositPaidAt: at('2026-09-01T05:00:00.000Z'), canceledAt: null, convertedAt: at('2026-09-02T02:00:00.000Z'), expireDate: at('2026-09-08T00:00:00.000Z'), createdAt: at('2026-09-01T03:00:00.000Z'), createdBy: u1, canceledBy: null },
      { id: 'b2', bookingNumber: 'BK-2', status: 'EXPIRED', depositAmount: '500.00', depositPaidAt: null, canceledAt: null, convertedAt: null, expireDate: at('2026-08-27T00:00:00.000Z'), createdAt: at('2026-08-20T03:00:00.000Z'), createdBy: u1, canceledBy: null },
    ]) },
    sale: { findMany: jest.fn().mockResolvedValue([
      sale({ id: 's1', saleNumber: 'SL-1', saleType: 'CASH', netAmount: '15900.00', createdAt: at('2026-09-02T03:00:00.000Z'), product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB' } }),
      sale({ id: 's2', saleNumber: 'SL-2', saleType: 'EXTERNAL_FINANCE', financeCompany: 'GFIN', saleSource: 'ONLINE', createdAt: at('2026-09-03T03:00:00.000Z'), deletedAt: at('2026-09-04T03:00:00.000Z'), voidedBy: u9 }),
      sale({ id: 's3', saleNumber: 'SL-3', saleType: 'INSTALLMENT', contractId: 'k1', createdAt: at('2026-09-05T03:00:00.000Z') }),
      sale({ id: 's4', saleNumber: 'SL-4', saleType: 'INSTALLMENT', contractId: 'k2', createdAt: at('2026-02-01T05:00:00.000Z') }),
    ]) },
    contract: { findMany: jest.fn().mockResolvedValue([
      { id: 'k1', contractNumber: 'CT-1', status: 'ACTIVE', totalMonths: 12, monthlyPayment: '4200.00', createdAt: at('2026-09-04T03:00:00.000Z'), deletedAt: null, reviewedAt: at('2026-09-04T10:00:00.000Z'), workflowStatus: 'APPROVED', salesperson: u1, reviewedBy: u9 },
      { id: 'k2', contractNumber: 'CT-2', status: 'COMPLETED', totalMonths: 6, monthlyPayment: '5000.00', createdAt: at('2026-02-01T03:00:00.000Z'), deletedAt: null, reviewedAt: at('2026-02-01T10:00:00.000Z'), workflowStatus: 'REJECTED', salesperson: u1, reviewedBy: u9 },
      { id: 'k3', contractNumber: 'CT-3', status: 'DRAFT', totalMonths: 10, monthlyPayment: '3000.00', createdAt: at('2026-08-09T03:00:00.000Z'), deletedAt: at('2026-08-10T03:00:00.000Z'), reviewedAt: null, workflowStatus: 'CREATING', salesperson: u1, reviewedBy: null },
    ]) },
    signature: { findMany: jest.fn().mockResolvedValue([{ id: 'sig1', contractId: 'k1', signedAt: at('2026-09-04T11:00:00.000Z') }]) },
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([{ kind: 'CONTRACT_ACTIVATED', refId: 'k2' }, { kind: 'CONTRACT_REVIEWED', refId: 'k2' }]) },
    payment: { findMany: jest.fn().mockResolvedValue([{ contractId: 'k2', paidDate: at('2026-08-31T04:00:00.000Z') }]) },
  };
}

describe('saleSource', () => {
  it('ใบจอง · ใบขาย · ยกเลิกใบขาย · สัญญา (ร่าง ตรวจ เซ็น เริ่มผ่อน ปิด) — ย้อนหลังข้ามเมื่อมี entry แล้ว', async () => {
    const db = saleDb();
    const events = await saleSource(db as unknown as PrismaService, ['c1'], { limit: 50 }, OWNER);
    expect(byId(events, 'booking-b1')).toMatchObject({ type: 'BOOKING_OPENED', stage: 'INTERESTED', title: 'เปิดใบจอง BK-1', actor: { type: 'STAFF', ...u1 } });
    expect(byId(events, 'booking-deposit-b1')).toMatchObject({ title: 'รับมัดจำ 1,000 บาท · BK-1' });
    expect(byId(events, 'booking-convert-b1')).toMatchObject({ title: 'แปลงใบจอง BK-1 เป็นใบขาย' });
    expect(byId(events, 'booking-expire-b2')).toMatchObject({ timestamp: '2026-08-27T00:00:00.000Z', title: 'ใบจอง BK-2 หมดอายุ', reliability: 'approximate' });
    expect(byId(events, 'sale-s1')).toMatchObject({ type: 'SALE_CASH', stage: 'PURCHASED', title: 'ซื้อเงินสด Apple iPhone 15 128GB 15,900 บาท', metadata: { saleNumber: 'SL-1' } });
    expect(byId(events, 'sale-s2')).toMatchObject({ type: 'SALE_EXTERNAL_FINANCE', title: 'ซื้อผ่านไฟแนนซ์ GFIN', actor: { type: 'SYSTEM', name: 'ออนไลน์' } });
    expect(byId(events, 'sale-void-s2')).toMatchObject({ type: 'SALE_VOIDED', title: 'ยกเลิกใบขาย SL-2', actor: { type: 'STAFF', ...u9 } });
    expect(byId(events, 'contract-k3')).toMatchObject({ title: 'ร่างสัญญาผ่อน CT-3 · ลบร่างแล้ว' });
    expect(byId(events, 'contract-k3')).not.toHaveProperty('href');
    expect(byId(events, 'contract-review-k1')).toMatchObject({ title: 'อนุมัติสัญญา CT-1', reliability: 'approximate', href: '/contracts/k1' });
    expect(byId(events, 'contract-review-k2')).toBeUndefined();
    expect(byId(events, 'signature-sig1')).toMatchObject({ title: 'ลูกค้าเซ็นสัญญา CT-1', actor: { type: 'CUSTOMER' } });
    expect(byId(events, 'activated-k1')).toMatchObject({ stage: 'PURCHASED', timestamp: '2026-09-05T03:00:00.000Z', title: 'เริ่มผ่อนสัญญา CT-1 · 12 งวด งวดละ 4,200 บาท', reliability: 'approximate' });
    expect(byId(events, 'activated-k2')).toBeUndefined();
    expect(byId(events, 'contract-end-k2')).toMatchObject({ timestamp: '2026-08-31T04:00:00.000Z', title: 'ปิดสัญญา CT-2: ผ่อนครบ' });
    expect(db.sale.findMany.mock.calls[0][0].select).not.toHaveProperty('voidReason');
    expect(db.signature.findMany.mock.calls[0][0].select).toEqual({ id: true, contractId: true, signedAt: true });
    expect(db.payment.findMany.mock.calls[0][0].where).toEqual({ contractId: { in: ['k2'] }, deletedAt: null, paidDate: { not: null } });
  });

  it('ไม่มีสัญญา → ไม่ยิงลายเซ็น/entry/งวด · คืนไม่เกิน limit+1', async () => {
    const db = saleDb();
    db.contract.findMany.mockResolvedValue([]);
    expect(await saleSource(db as unknown as PrismaService, ['c1'], { limit: 2 }, OWNER)).toHaveLength(3);
    expect(db.signature.findMany).not.toHaveBeenCalled();
    expect(db.customerJourneyEntry.findMany).not.toHaveBeenCalled();
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});
