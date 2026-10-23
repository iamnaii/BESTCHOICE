import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SaleReceiptPdfService } from '../src/modules/sales/services/sale-receipt-pdf.service';
import { RECEIPT_TOKEN_TTL_MS, SaleReceiptTokenService } from '../src/modules/sales/services/sale-receipt-token.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

/**
 * ใบเสร็จขายสด (ก้อน 4) บน PostgreSQL จริง — ตัวเลขบนใบ, ขอบเขตสาขา, ใบยกเลิก, และวงจร token
 * ผ่าน `SaleReceiptPdfService.loadReceiptModel` (ไม่แตะ puppeteer). ปิดช่องที่ unit spec mock collaborator
 * แล้วปล่อยบั๊กผ่าน (final review 2026-10-23): ensureToken กรองใบยกเลิก · net ยังไม่หัก base เทิร์น ·
 * มัดจำจองไม่ใช่ tender ของ Sale.
 */
describe('Sale receipt on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `ISOLATED-SALE-RECEIPT-${randomUUID()}`;
  const config = { get: () => 'https://shop.example.test' } as unknown as ConfigService;
  const tokens = new SaleReceiptTokenService(db, config);
  const service = new SaleReceiptPdfService(db, tokens);

  let branchA: string, branchB: string, userA: string, customerId: string;
  let tradeInSale: string, bookedSale: string, prepaidSale: string, voidedSale: string, otherBranchSale: string;
  const owner = { id: 'owner', role: 'OWNER', branchId: null };
  let salesA: { id: string; role: string; branchId: string };

  beforeAll(async () => {
    await db.$connect();
    branchA = (await db.branch.create({ data: { name: `${prefix}-A` } })).id;
    branchB = (await db.branch.create({ data: { name: `${prefix}-B` } })).id;
    userA = (await db.user.create({ data: {
      name: `${prefix}-A`, email: `${prefix}-A@example.invalid`, password: 'unused',
      role: 'SALES', branchId: branchA, accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP',
    } })).id;
    salesA = { id: userA, role: 'SALES', branchId: branchA };
    customerId = (await db.customer.create({ data: { name: `${prefix} ลูกค้า`, phone: '0800000000' } })).id;
    const product = (branchId: string, suffix: string) => db.product.create({ data: {
      name: `${prefix}-${suffix}`, brand: 'TEST', model: 'TEST', category: 'PHONE_USED',
      costPrice: '6000', cashPrice: '31900', branchId, imeiSerial: `${prefix}-${suffix}`,
    } });
    const freebie = await db.product.create({ data: {
      name: `${prefix}-CASE`, brand: 'TEST', model: 'CASE', category: 'ACCESSORY', costPrice: '10', cashPrice: '0', branchId: branchA,
      legacyProductCode: `${prefix}-ACC`,
    } });
    const base = (suffix: string, branchId: string, productId: string) => ({
      saleNumber: `${prefix}-${suffix}`, saleType: 'CASH' as const, customerId, productId, branchId, salespersonId: userA,
      createdAt: new Date('2026-01-15T05:00:00Z'),
    });
    const tender = (saleId: string, method: 'CASH' | 'BANK_TRANSFER', amount: string, seq: number, reference: string | null = null) =>
      db.shopTender.create({ data: { direction: 'IN', kind: 'CASH_SALE', branchId: branchA, method, amount, reference, actorId: userA, seq, seqTotal: 2, saleId } });

    // 1) ขายสดใช้เครดิตเทิร์น — ตามโค้ดขายจริง: net = 31,900 − 1,000 = 30,900 · cashDue = 30,900 − 8,000 = 22,900
    tradeInSale = (await db.sale.create({ data: {
      ...base('TRADE', branchA, (await product(branchA, 'TRADE')).id),
      sellingPrice: '31900', discount: '1000', netAmount: '30900', paymentMethod: 'CASH', amountReceived: '22900',
      bundleProductIds: [freebie.id],
      tradeInCreditSnapshot: { version: 1, redemptionId: 'r', tradeInId: 't', voucherNumber: `${prefix}-TI`, baseAmount: '8000.00', bonusAmount: '0.00', cashDownAmount: '22900.00', totalDownAmount: '30900.00' },
    } })).id;
    await tender(tradeInSale, 'CASH', '5000', 1);
    await tender(tradeInSale, 'BANK_TRANSFER', '17900', 2, '2510221432');

    // 2) ใบจากการจอง — มัดจำ 5,000 บน Booking · รับเพิ่ม 17,900 เป็น tender ของ Sale
    bookedSale = (await db.sale.create({ data: {
      ...base('BOOKED', branchA, (await product(branchA, 'BOOKED')).id),
      sellingPrice: '22900', discount: '0', netAmount: '22900', paymentMethod: 'BANK_TRANSFER', amountReceived: '22900', downPaymentAmount: '5000',
    } })).id;
    await db.booking.create({ data: {
      bookingNumber: `${prefix}-BK1`, customerId, branchId: branchA, createdById: userA, depositAmount: '5000', totalAmount: '22900',
      depositMethod: 'BANK_TRANSFER', depositPaidAt: new Date('2026-01-10T05:00:00Z'), expireDate: new Date('2026-01-20T17:00:00Z'),
      status: 'CONVERTED', convertedAt: new Date('2026-01-15T05:00:00Z'), convertedToSaleId: bookedSale,
    } });
    await db.shopTender.create({ data: { direction: 'IN', kind: 'CASH_SALE', branchId: branchA, method: 'BANK_TRANSFER', amount: '17900', reference: '2510221510', actorId: userA, seq: 1, seqTotal: 1, saleId: bookedSale } });

    // 3) ใบจากการจองที่จ่ายครบล่วงหน้า — ไม่มี tender ของ Sale เลย
    prepaidSale = (await db.sale.create({ data: {
      ...base('PREPAID', branchA, (await product(branchA, 'PREPAID')).id),
      sellingPrice: '22900', discount: '0', netAmount: '22900', paymentMethod: 'CASH', amountReceived: '22900', downPaymentAmount: '22900',
    } })).id;
    await db.booking.create({ data: {
      bookingNumber: `${prefix}-BK2`, customerId, branchId: branchA, createdById: userA, depositAmount: '22900', totalAmount: '22900',
      depositMethod: 'CASH', depositPaidAt: new Date('2026-01-10T05:00:00Z'), expireDate: new Date('2026-01-20T17:00:00Z'),
      status: 'CONVERTED', convertedAt: new Date('2026-01-15T05:00:00Z'), convertedToSaleId: prepaidSale,
    } });

    // 4) ใบยกเลิก (เคยมี token) · 5) ใบสาขา B
    voidedSale = (await db.sale.create({ data: {
      ...base('VOID', branchA, (await product(branchA, 'VOID')).id),
      sellingPrice: '9000', discount: '0', netAmount: '9000', paymentMethod: 'CASH', amountReceived: '9000',
      deletedAt: new Date('2026-01-16T05:00:00Z'), voidReason: 'คีย์ผิดเครื่อง',
      receiptToken: `${prefix}-OLD-TOKEN`, receiptTokenExpiresAt: new Date(Date.now() + 86_400_000),
    } })).id;
    otherBranchSale = (await db.sale.create({ data: {
      ...base('B', branchB, (await product(branchB, 'B')).id),
      sellingPrice: '9000', discount: '0', netAmount: '9000', paymentMethod: 'CASH', amountReceived: '9000',
    } })).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('trade-in sale: net before the credit, received after; freebie row and tenders from real rows', async () => {
    const m = await service.loadReceiptModel(tradeInSale, owner);
    expect(m.totals).toMatchObject({ gross: '31900.00', discount: '1000.00', net: '30900.00', received: '22900.00' });
    expect(m.totals.tradeIn).toEqual({ voucher: `${prefix}-TI`, amount: '8000.00' });
    expect(m.tenders).toEqual([
      { label: 'เงินสด', amount: '5000.00', reference: null },
      { label: 'โอน', amount: '17900.00', reference: '2510221432' },
    ]);
    expect(m.bundleItems).toEqual([{ name: `${prefix}-CASE`, idText: `${prefix}-ACC` }]);
    expect(m.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const row = await db.sale.findUniqueOrThrow({ where: { id: tradeInSale }, select: { receiptToken: true, receiptTokenExpiresAt: true } });
    expect(row.receiptToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(row.receiptTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + RECEIPT_TOKEN_TTL_MS - 60_000);
  });

  it('booking-converted sale: received = deposit + balance tenders', async () => {
    const m = await service.loadReceiptModel(bookedSale, owner);
    expect(m.depositLine).toEqual({ label: 'มัดจำจอง (โอน)', amount: '5000.00' });
    expect(m.tenders).toEqual([{ label: 'โอน', amount: '17900.00', reference: '2510221510' }]);
    expect(m.totals.received).toBe('22900.00');
  });

  it('fully prepaid booking: deposit only, no fallback tender line', async () => {
    const m = await service.loadReceiptModel(prepaidSale, owner);
    expect(m.depositLine).toEqual({ label: 'มัดจำจอง (เงินสด)', amount: '22900.00' });
    expect(m.tenders).toEqual([]);
    expect(m.totals.received).toBe('22900.00');
  });

  it('voided sale: staff gets the watermark model with the old token untouched; public path is 404', async () => {
    const before = await db.sale.findUniqueOrThrow({ where: { id: voidedSale }, select: { receiptToken: true, receiptTokenExpiresAt: true } });
    const m = await service.loadReceiptModel(voidedSale, owner);
    expect(m.voided).toMatchObject({ reason: 'คีย์ผิดเครื่อง' });
    expect(m.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const after = await db.sale.findUniqueOrThrow({ where: { id: voidedSale }, select: { receiptToken: true, receiptTokenExpiresAt: true } });
    expect(after).toEqual(before);
    await expect(tokens.findSaleIdByToken(`${prefix}-OLD-TOKEN`)).resolves.toBeNull();
    await expect(service.loadReceiptModel(voidedSale, null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('public path does not extend the token expiry; expired token resolves to nothing', async () => {
    const { token, expiresAt } = await tokens.ensureToken(tradeInSale);
    await expect(tokens.findSaleIdByToken(token)).resolves.toBe(tradeInSale);
    const m = await service.loadReceiptModel(tradeInSale, null);
    expect(m.saleNumber).toBe(`${prefix}-TRADE`);
    const row = await db.sale.findUniqueOrThrow({ where: { id: tradeInSale }, select: { receiptTokenExpiresAt: true } });
    expect(row.receiptTokenExpiresAt!.getTime()).toBe(expiresAt.getTime());

    await db.sale.update({ where: { id: tradeInSale }, data: { receiptTokenExpiresAt: new Date(Date.now() - 1_000) } });
    await expect(tokens.findSaleIdByToken(token)).resolves.toBeNull();
    const refreshed = await tokens.ensureToken(tradeInSale);
    expect(refreshed.token).toBe(token);
    await expect(tokens.findSaleIdByToken(token)).resolves.toBe(tradeInSale);
  });

  it('SALES actor is scoped to their branch; installment sales are refused', async () => {
    await expect(service.loadReceiptModel(otherBranchSale, salesA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.loadReceiptModel(tradeInSale, salesA)).resolves.toMatchObject({ saleNumber: `${prefix}-TRADE` });
    const installment = await db.sale.create({ data: {
      saleNumber: `${prefix}-INST`, saleType: 'INSTALLMENT', customerId, branchId: branchA, salespersonId: userA,
      productId: (await db.product.create({ data: { name: `${prefix}-INST`, brand: 'T', model: 'T', category: 'PHONE_NEW', costPrice: '1', cashPrice: '2', branchId: branchA, imeiSerial: `${prefix}-INST` } })).id,
      sellingPrice: '9000', discount: '0', netAmount: '9000',
    } });
    await expect(service.loadReceiptModel(installment.id, owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});
