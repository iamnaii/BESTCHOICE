/**
 * ล็อกเครื่องเมื่อรับมัดจำ — วงจรจริงบน DB จริง (PR 2, spec 2026-10-05 §4)
 * สิ่งที่ unit spec (mock prisma) มองไม่เห็น:
 *   1. รับมัดจำ → เครื่อง RESERVED + lockedProductId · ใบที่สองบนเครื่องเดียวกันรับมัดจำไม่ได้ (409 ข้อความ spec)
 *   2. สองใบรับมัดจำพร้อมกัน → สำเร็จใบเดียว (CAS)
 *   3. ยกเลิกใบ PAID → IN_STOCK + lockedProductId ว่าง + unlockedAt
 *   4. autoExpire ใบ PAID → IN_STOCK + ริบมัดจำ
 *   5. แปลงขายจากเครื่องที่ล็อก → SOLD_CASH + lockedProductId ว่าง · ใบจองใบใหม่บนเครื่องเดิมหลังขายไม่ชน unique
 *   6. partial unique: ตั้ง lockedProductId ซ้ำบนใบเปิดอีกใบตรง ๆ → P2002
 * รัน: cd apps/api && npx vitest run --no-file-parallelism src/modules/bookings/__tests__/booking-lock.integration.spec.ts
 * CI: glob BOOKINGS_FILES ใน deploy-gcp.yml (glob ไม่ recurse เอง)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { BookingsService, LOCK_FAILED_MSG } from '../bookings.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';

// ประกอบ service ด้วย `new` แบบเดียวกับ apps/api/e2e/bookings-lifecycle.e2e-spec.ts (constructor args อยู่ใน beforeAll ด้านล่าง)
const db = new PrismaService();
const PREFIX = `TEST-LOCK-${randomUUID().slice(0, 8)}`;
let bookings: BookingsService;
let branchId: string; let customerId: string; let actor: any; let shopId: string;

const seedProduct = () => db.product.create({ data: {
  name: PREFIX, brand: 'SYNTHETIC', model: 'LOCK', category: 'PHONE_NEW',
  imeiSerial: `${PREFIX}-${randomUUID()}`, branchId, ownedByCompanyId: shopId,
  costPrice: 6000, cashPrice: 10000, status: 'IN_STOCK',
} });
const createBooking = (productId: string) => bookings.create({
  customerId, branchId, depositAmount: 1000,
  expireDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  items: [{ productId, description: PREFIX, quantity: 1, unitPrice: 10000 }],
} as any, actor.id, actor);
const pay = (id: string) => bookings.payDeposit(id, { depositMethod: 'CASH' } as any, actor);
const productStatus = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await db.$connect();
  await seedShopCoa(db);
  shopId = (await db.companyInfo.upsert({ where: { companyCode: 'SHOP' }, create: {
    companyCode: 'SHOP', nameTh: 'ISOLATED SHOP', taxId: '9999999999996', address: 'Synthetic Road',
    directorName: 'Synthetic Director', vatRegistered: true, vatRate: '0.0700',
  }, update: {} })).id;
  await db.user.upsert({ where: { email: 'admin@bestchoice.com' }, create: {
    email: 'admin@bestchoice.com', password: 'unused', name: 'ISOLATED OWNER', role: 'OWNER',
  }, update: {} });
  branchId = (await db.branch.create({ data: { name: PREFIX, companyId: shopId, shopCashAccountCode: 'S11-1101' } })).id;
  actor = { id: (await db.user.create({ data: { name: PREFIX, email: `${PREFIX}@example.invalid`,
    password: 'unused', role: 'SALES', branchId } })).id, role: 'SALES', branchId };
  // ลูกค้าทดสอบต้องเป็นฝั่ง TEST- เหมือนเครื่อง (รั้ว assertSameTestSide อ่านที่อยู่ปัจจุบัน/เบอร์ ไม่ใช่ชื่อ)
  customerId = (await db.customer.create({ data: { name: PREFIX, phone: '0800000000', nationalId: '7900000000003', addressCurrent: TEST_CUSTOMER_ADDRESS } })).id;
  const journal = new JournalAutoService(db); const companies = new CompanyResolverService(db);
  bookings = new BookingsService(db,
    new ShopBookingDepositTemplate(journal, db, companies),
    new ShopBookingForfeitTemplate(journal, db, companies),
    new ShopBookingDepositAppliedTemplate(journal, db, companies),
    new ShopCashSaleTemplate(journal, db, companies),
    new ShopBookingRefundTemplate(journal, db, companies),
    new ShopAccountResolver(db));
});
afterAll(async () => {
  // ล้างเฉพาะแถวของรอบนี้ (PREFIX) — ลำดับตาม FK: tender/JE ของใบ → รายการ → ใบ → ใบขาย → เครื่อง → ลูกค้า
  const ids = (await db.booking.findMany({ where: { bookingNumber: { startsWith: 'BK-' }, customerId }, select: { id: true } })).map((b) => b.id);
  await db.shopTender.deleteMany({ where: { bookingId: { in: ids } } });
  const jes = await db.journalEntry.findMany({ where: { metadata: { path: ['bookingId'], string_contains: '' } }, select: { id: true, metadata: true } });
  const jeIds = jes.filter((j) => ids.includes(String((j.metadata as Record<string, unknown>)?.bookingId))).map((j) => j.id);
  await db.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
  await db.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  await db.salesCommission.deleteMany({ where: { sale: { customerId } } });
  await db.bookingItem.deleteMany({ where: { bookingId: { in: ids } } });
  await db.booking.deleteMany({ where: { id: { in: ids } } });
  await db.saleCostSnapshot.deleteMany({ where: { sale: { customerId } } });
  await db.sale.deleteMany({ where: { customerId } });
  await db.product.deleteMany({ where: { name: PREFIX } });
  await db.customer.deleteMany({ where: { id: customerId } });
  // ผู้ใช้/สาขาของรอบนี้ไม่ลบ: audit_logs (immutable) อ้าง user_id ทำให้ FK ค้าง — ทั้งคู่ขึ้นต้น PREFIX (TEST-LOCK-) อยู่แล้ว
  await db.$disconnect();
});

describe('ล็อกเครื่องเมื่อรับมัดจำ', () => {
  it('รับมัดจำ → RESERVED + lockedProductId · ใบที่สองบนเครื่องเดียวกันได้ 409 และเงินไม่เข้า', async () => {
    const product = await seedProduct();
    const first = await createBooking(product.id);
    const second = await createBooking(product.id); // สร้างได้ (ยังไม่ล็อกตอนสร้าง — คำตัดสินข้อ 1)
    await pay(first.id);
    expect(await productStatus(product.id)).toBe('RESERVED');
    const locked = await db.booking.findUniqueOrThrow({ where: { id: first.id } });
    expect(locked.lockedProductId).toBe(product.id);
    expect(locked.lockedAt).toBeInstanceOf(Date);
    // ลำดับเวลา: ด่านอ่านของ payDeposit เห็นเครื่อง RESERVED แล้ว → 400 ข้อความ "ไม่พร้อมขาย" (LOCK_FAILED_MSG 409 เกิดเฉพาะตอนแข่งกัน — ดูเทสถัดไป)
    await expect(pay(second.id)).rejects.toThrow('เครื่องนี้ไม่พร้อมขาย');
    expect((await db.booking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PENDING_DEPOSIT');
    expect(await db.shopTender.count({ where: { bookingId: second.id } })).toBe(0);
  });

  it('สองใบรับมัดจำพร้อมกัน → สำเร็จใบเดียว', async () => {
    const product = await seedProduct();
    const a = await createBooking(product.id); const b = await createBooking(product.id);
    const results = await Promise.allSettled([pay(a.id), pay(b.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // ผู้แพ้: ได้ LOCK_FAILED_MSG (แพ้ CAS/unique) หรือ "ไม่พร้อมขาย" (ด่านอ่านเห็นผู้ชนะ commit แล้ว) — ต้องเป็นหนึ่งในสองเสมอ
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(String(loser.reason?.message)).toMatch(new RegExp(`${LOCK_FAILED_MSG}|เครื่องนี้ไม่พร้อมขาย`));
    expect(await productStatus(product.id)).toBe('RESERVED');
    expect(await db.booking.count({ where: { lockedProductId: product.id, deletedAt: null } })).toBe(1);
  });

  it('ยกเลิกใบ PAID → IN_STOCK + lockedProductId ว่าง + unlockedAt', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    await bookings.cancel(b.id, { cancelReason: 'ลูกค้าเปลี่ยนใจ' }, actor);
    expect(await productStatus(product.id)).toBe('IN_STOCK');
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.lockedProductId).toBeNull(); expect(row.unlockedAt).toBeInstanceOf(Date); expect(row.lockedAt).toBeInstanceOf(Date);
  });

  it('autoExpire ใบ PAID → IN_STOCK + EXPIRED', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    await db.booking.update({ where: { id: b.id }, data: { expireDate: new Date(Date.now() - 60_000) } });
    expect(await bookings.autoExpire(new Date())).toBeGreaterThanOrEqual(1);
    expect(await productStatus(product.id)).toBe('IN_STOCK');
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe('EXPIRED'); expect(row.lockedProductId).toBeNull();
  });

  it('แปลงขายจากเครื่องที่ล็อก → SOLD_CASH + lockedProductId ว่าง · ใบใหม่บนเครื่องเดิมหลังคืนสต็อกไม่ชน unique', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    const { sale } = await bookings.convertToSale(b.id, { collectBalance: true, paymentMethod: 'CASH' } as any, actor.id, actor);
    expect(sale.id).toBeTruthy();
    expect(await productStatus(product.id)).toBe('SOLD_CASH');
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).lockedProductId).toBeNull();
    // จำลองเครื่องกลับเข้าสต็อก (void ใบขาย) แล้วจองใหม่ — unique ต้องไม่ชนเพราะใบ CONVERTED ล้าง lockedProductId แล้ว
    await db.product.update({ where: { id: product.id }, data: { status: 'IN_STOCK' } });
    const again = await createBooking(product.id);
    await expect(pay(again.id)).resolves.toBeDefined();
  });

  it('partial unique: ตั้ง lockedProductId ซ้ำบนใบเปิดอีกใบตรง ๆ → P2002', async () => {
    const product = await seedProduct(); const a = await createBooking(product.id); const b = await createBooking(product.id);
    await pay(a.id);
    await expect(db.booking.update({ where: { id: b.id }, data: { lockedProductId: product.id } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});
