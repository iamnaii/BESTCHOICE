import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/**
 * สัญญาหนึ่งใบมีงวดที่ชำระแล้ว 60 งวด (มากกว่าเพดานเดิม 50 แถวต่อสัญญาของ full-timeline) —
 * เดินหน้าละ 30 ด้วย cursor ต้องได้ครบ 60 ไม่ซ้ำ ไม่ข้าม ⇒ พิสูจน์ว่า window ลงไปถึง contractEventSources (Task 7)
 * ผู้ใช้ upsert ด้วยอีเมลคงที่ไม่ลบ · แถวอื่นลบใน afterAll
 */
describe('CustomerJourneyService.list (real DB) — ชำระ 60 งวดเดินด้วย cursor', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const service = new CustomerJourneyService(db, new JourneySummaryService(db, new JourneyStateService(db)));
  const stamp = Date.now();
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const dec = (value: string) => new Prisma.Decimal(value);
  const ids = { branch: '', customer: '', product: '', contract: '' };
  const paymentIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: 'journey-payments-cursor@example.test' },
      update: {},
      create: { email: 'journey-payments-cursor@example.test', password: 'journey-spec', name: 'สเปคชำระ 60 งวด', role: 'OWNER' },
    });
    ids.branch = (await prisma.branch.create({ data: { name: `journey payments spec ${stamp}` } })).id;
    ids.customer = (await prisma.customer.create({ data: { name: `journey payments spec ${stamp}` } })).id;
    ids.product = (await prisma.product.create({
      data: { name: 'journey payments phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: dec('20000.00'), branchId: ids.branch, imeiSerial: `JPC-${stamp}` },
    })).id;
    ids.contract = (await prisma.contract.create({
      data: {
        contractNumber: `JPC-${stamp}`, customerId: ids.customer, productId: ids.product, branchId: ids.branch, salespersonId: user.id, planType: 'STORE_WITH_INTEREST',
        sellingPrice: dec('72000.00'), downPayment: dec('0.00'), interestRate: dec('0.0000'), totalMonths: 60, interestTotal: dec('0.00'),
        financedAmount: dec('72000.00'), monthlyPayment: dec('1200.00'), status: 'ACTIVE',
      },
    })).id;
    for (let n = 1; n <= 60; n += 1) {
      const row = await prisma.payment.create({
        data: {
          contractId: ids.contract, installmentNo: n, dueDate: new Date(Date.UTC(2026, 0, n)), amountDue: dec('1200.00'), amountPaid: dec('1200.00'),
          status: 'PAID', updatedAt: new Date(Date.UTC(2026, 0, n, 3)),
        },
      });
      paymentIds.push(row.id);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { contractId: ids.contract } });
    await prisma.contract.deleteMany({ where: { id: ids.contract } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.customer.deleteMany({ where: { id: ids.customer } });
    await prisma.branch.deleteMany({ where: { id: ids.branch } });
    await prisma.$disconnect();
  }, 60_000);

  it('limit 30: หน้าแรก 30 + nextCursor · หน้าสอง 30 ไม่มี cursor · รวม 60 ตรงกับทุกงวด เรียงใหม่→เก่า', async () => {
    const walked: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await service.list(ids.customer, { groups: ['payment'], limit: 30, cursor }, OWNER);
      if (!('events' in result)) throw new Error('ได้ redirect');
      walked.push(...result.events.map((event) => event.id));
      pageSizes.push(result.events.length);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(pageSizes).toEqual([30, 30]);
    expect(new Set(walked).size).toBe(60);
    expect([...walked].sort()).toEqual(paymentIds.map((id) => `payment-${id}`).sort());
    expect(walked[0]).toBe(`payment-${paymentIds[59]}`);
    expect(walked[59]).toBe(`payment-${paymentIds[0]}`);
  }, 60_000);
});
