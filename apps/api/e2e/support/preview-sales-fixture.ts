import { PrismaService } from '../../src/prisma/prisma.service';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { JournalAutoService } from '../../src/modules/journal/journal-auto.service';
import { CompanyResolverService } from '../../src/modules/journal/company-resolver.service';
import { ShopAccountResolver } from '../../src/modules/journal/shop-account-resolver.service';
import { ShopBookingDepositTemplate } from '../../src/modules/journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../src/modules/journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../src/modules/journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../src/modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../src/modules/journal/cpa-templates/shop-booking-refund.template';
import { seedShopCoa } from '../../prisma/seed-coa-shop';
import { TEST_CUSTOMER_ADDRESS, TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from '../../src/utils/test-data-markers';

export function previewBookings(db: PrismaService) {
  const journal = new JournalAutoService(db), companies = new CompanyResolverService(db);
  return new BookingsService(db, new ShopBookingDepositTemplate(journal, db, companies),
    new ShopBookingForfeitTemplate(journal, db, companies), new ShopBookingDepositAppliedTemplate(journal, db, companies),
    new ShopCashSaleTemplate(journal, db, companies), new ShopBookingRefundTemplate(journal, db, companies), new ShopAccountResolver(db));
}

/** A real booking/deposit/conversion using only the disposable local database. */
export async function seedPreviewSales(db: PrismaService, actor: { id: string; role: string }) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Sales fixtures require disposable PostgreSQL');
  const note = `${TEST_NOTE_MARKER} LOCAL-MIXED-BOOKING-RECEIPT`;
  const existing = await db.booking.findFirst({ where: { notes: note, deletedAt: null } });
  if (existing?.convertedToSaleId) return { bookingId: existing.id, saleId: existing.convertedToSaleId };
  await seedShopCoa(db);
  await db.user.upsert({ where: { email: 'admin@bestchoice.com' }, update: {}, create: { email: 'admin@bestchoice.com', password: 'unused', name: 'LOCAL SYSTEM', role: 'OWNER' } });
  const branch = await db.branch.findFirstOrThrow({ where: { name: 'LOCAL PREVIEW BRANCH', deletedAt: null } });
  const customer = await db.customer.upsert({ where: { id: '53000000-0000-4000-8000-000000000001' }, update: {}, create: {
    id: '53000000-0000-4000-8000-000000000001', name: `${TEST_NAME_PREFIX} — ลูกค้าใบจอง`, nationalId: '7900000000099', phone: '0800000099', addressCurrent: TEST_CUSTOMER_ADDRESS } });
  const product = await db.product.upsert({ where: { id: '53000000-0000-4000-8000-000000000002' }, update: {}, create: {
    id: '53000000-0000-4000-8000-000000000002', name: `${TEST_NAME_PREFIX} — เครื่องจากใบจอง`, brand: 'LOCAL', model: 'BOOKING', category: 'PHONE_NEW',
    imeiSerial: `${TEST_DOC_PREFIX}LOCAL-BOOKING`, costPrice: 6000, cashPrice: 10000, branchId: branch.id, ownedByCompanyId: branch.companyId, status: 'IN_STOCK' } });
  const service = previewBookings(db);
  const booking = existing ?? await service.create({ customerId: customer.id, branchId: branch.id, depositAmount: 1000,
    expireDate: new Date(Date.now() + 7 * 86400000).toISOString(), notes: note,
    items: [{ productId: product.id, description: product.name, quantity: 1, unitPrice: 10000 }] }, actor.id, actor);
  if (booking.status === 'PENDING_DEPOSIT') await service.payDeposit(booking.id, { depositMethod: 'CASH' }, actor);
  // กติกาช่องรับเงิน (2026-09-20): โอนต้องมีเลขอ้างอิงจากสลิป — paymentMethod แบบเดิมไม่มีช่องเลขอ้างอิง จึงส่งเป็น tender เดียว
  // เท่ายอดส่วนที่เหลือพอดี (ยอดรวม 10,000 − มัดจำ 1,000 = 9,000; อ่านจากใบจองเพื่อรองรับใบที่ seed ค้างไว้จากรอบก่อน)
  const balance = booking.totalAmount.minus(booking.depositAmount).toNumber();
  const result = await service.convertToSale(booking.id, { collectBalance: true,
    tenders: [{ method: 'BANK_TRANSFER', amount: balance, reference: `${TEST_DOC_PREFIX}REF-BOOKING-0001` }] }, actor.id, actor);
  return { bookingId: booking.id, saleId: result.sale.id };
}

/**
 * ใบขาย "ไฟแนนซ์นอก" หนึ่งใบ — มีไว้ให้ชิป ไฟแนนซ์นอก, KPI ไฟแนนซ์นอก และคอลัมน์
 * ประกันถึง (ประกันร้านมาจาก Sale.shopWarrantyEndDate) มองเห็นได้จริงบน local preview
 * ก่อนหน้านี้ฐานข้อมูล preview ไม่มีใบขายประเภทนี้เลย ⇒ ยืนยันไม่ได้ว่าทำงาน
 */
export async function seedPreviewExternalFinanceSale(db: PrismaService, salespersonId: string) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Sales fixtures require disposable PostgreSQL');
  const saleNumber = `${TEST_DOC_PREFIX}LOCAL-EXTFIN-0001`;
  const existing = await db.sale.findUnique({ where: { saleNumber } });
  if (existing) return { saleId: existing.id };
  const branch = await db.branch.findFirstOrThrow({ where: { name: 'LOCAL PREVIEW BRANCH', deletedAt: null } });
  const customer = await db.customer.upsert({ where: { id: '53000000-0000-4000-8000-000000000011' }, update: {}, create: {
    id: '53000000-0000-4000-8000-000000000011', name: `${TEST_NAME_PREFIX} — ลูกค้าไฟแนนซ์นอก`,
    nationalId: '7900000000098', phone: '0800000098', addressCurrent: TEST_CUSTOMER_ADDRESS } });
  const product = await db.product.upsert({ where: { id: '53000000-0000-4000-8000-000000000012' }, update: {}, create: {
    id: '53000000-0000-4000-8000-000000000012', name: `${TEST_NAME_PREFIX} — เครื่องไฟแนนซ์นอก`, brand: 'Samsung',
    model: 'Galaxy S24', storage: '256GB', category: 'PHONE_NEW', imeiSerial: `${TEST_DOC_PREFIX}LOCAL-EXTFIN`,
    costPrice: 12000, cashPrice: 18000, branchId: branch.id, ownedByCompanyId: branch.companyId, status: 'SOLD_CASH',
    warrantyExpireDate: new Date(Date.now() + 300 * 86400000) } });
  const sale = await db.sale.create({ data: {
    saleNumber, saleType: 'EXTERNAL_FINANCE', customerId: customer.id, productId: product.id,
    branchId: branch.id, salespersonId, sellingPrice: 18000, netAmount: 18000,
    financeCompany: 'LOCAL FINANCE CO', financeRefNumber: `${TEST_DOC_PREFIX}REF-0001`, financeAmount: 15000,
    downPaymentAmount: 3000, notes: `${TEST_NOTE_MARKER} LOCAL-EXTERNAL-FINANCE`,
    shopWarrantyStartDate: new Date(), shopWarrantyEndDate: new Date(Date.now() + 30 * 86400000) } });
  return { saleId: sale.id };
}
