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
  const result = await service.convertToSale(booking.id, { collectBalance: true, paymentMethod: 'BANK_TRANSFER' }, actor.id, actor);
  return { bookingId: booking.id, saleId: result.sale.id };
}
