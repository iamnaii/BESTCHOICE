import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedShopCoa } from '../prisma/seed-coa-shop';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { CompanyResolverService } from '../src/modules/journal/company-resolver.service';
import { ShopAccountResolver } from '../src/modules/journal/shop-account-resolver.service';
import { ShopCashSaleTemplate } from '../src/modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingDepositTemplate } from '../src/modules/journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingRefundTemplate } from '../src/modules/journal/cpa-templates/shop-booking-refund.template';
import { ShopBookingForfeitTemplate } from '../src/modules/journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../src/modules/journal/cpa-templates/shop-booking-deposit-applied.template';
import { BookingsService } from '../src/modules/bookings/bookings.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('Booking mutations and real SHOP ledger on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `ISOLATED-BOOKING-${randomUUID()}`;
  let bookings: BookingsService, depositTemplate: ShopBookingDepositTemplate, forfeitTemplate: ShopBookingForfeitTemplate;
  let branchId: string, shopId: string, customerId: string;
  let actor: { id: string; role: string; branchId: string };
  const readEntries = (bookingId: string) => db.journalEntry.findMany({
    where: { deletedAt: null, metadata: { path: ['bookingId'], equals: bookingId } }, include: { lines: true },
  });
  const cashNet = async (bookingId: string) => (await readEntries(bookingId)).flatMap(row => row.lines)
    .filter(line => line.accountCode === 'S11-1101')
    .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Decimal(0)).toNumber();

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
    branchId = (await db.branch.create({ data: { name: prefix, companyId: shopId, shopCashAccountCode: 'S11-1101' } })).id;
    actor = { id: (await db.user.create({ data: { name: prefix, email: `${prefix}@example.invalid`,
      password: 'unused', role: 'SALES', branchId } })).id, role: 'SALES', branchId };
    customerId = (await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId: '7900000000003' } })).id;
    const journal = new JournalAutoService(db), companies = new CompanyResolverService(db);
    depositTemplate = new ShopBookingDepositTemplate(journal, db, companies);
    forfeitTemplate = new ShopBookingForfeitTemplate(journal, db, companies);
    bookings = new BookingsService(db, depositTemplate, forfeitTemplate,
      new ShopBookingDepositAppliedTemplate(journal, db, companies), new ShopCashSaleTemplate(journal, db, companies),
      new ShopBookingRefundTemplate(journal, db, companies), new ShopAccountResolver(db));
  });
  afterAll(async () => { await db.$disconnect(); });

  const createBooking = async () => {
    const product = await db.product.create({ data: { name: prefix, brand: 'SYNTHETIC', model: 'BOOKING',
      category: 'PHONE_NEW', imeiSerial: `${prefix}-${randomUUID()}`, branchId, ownedByCompanyId: shopId,
      costPrice: 6000, cashPrice: 10000, status: 'IN_STOCK' } });
    const booking = await bookings.create({ customerId, branchId, depositAmount: 1000,
      expireDate: new Date(Date.now() + 86400000).toISOString(),
      items: [{ productId: product.id, description: prefix, quantity: 1, unitPrice: 10000 }],
    }, actor.id, actor);
    return { booking, product };
  };
  const pay = (id: string) => bookings.payDeposit(id, { depositMethod: 'CASH' }, actor);

  it.each([1, 2, 3])('keeps a concurrent deposit edit and payment consistent (%s)', async () => {
    const { booking } = await createBooking();
    const results = await Promise.allSettled([
      bookings.update(booking.id, { depositAmount: 2000 }, actor), pay(booking.id),
    ]);
    expect(results[1].status).toBe('fulfilled');
    const stored = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('PAID');
    expect(await cashNet(booking.id)).toBe(stored.depositAmount.toNumber());
    expect(await readEntries(booking.id)).toHaveLength(1);
    await expect(pay(booking.id)).rejects.toThrow();
    expect(await readEntries(booking.id)).toHaveLength(1);
  });

  it.each([1, 2, 3])('refunds exactly what was received when cancel races payment (%s)', async () => {
    const { booking } = await createBooking();
    const results = await Promise.allSettled([
      pay(booking.id), bookings.cancel(booking.id, { cancelReason: 'Synthetic concurrent cancellation' }, actor),
    ]);
    expect(results[1].status).toBe('fulfilled');
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELED');
    expect(await cashNet(booking.id)).toBe(0);
  });

  it('does not soft-delete received money when deletion races payment', async () => {
    const { booking } = await createBooking();
    await Promise.allSettled([pay(booking.id), bookings.remove(booking.id, actor)]);
    const stored = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    if (stored.status === 'PAID') {
      expect(stored.deletedAt).toBeNull();
      expect(await cashNet(booking.id)).toBe(1000);
    } else {
      expect(stored.status).toBe('PENDING_DEPOSIT');
      expect(stored.deletedAt).not.toBeNull();
      expect(await cashNet(booking.id)).toBe(0);
    }
  });

  it('rolls back the status and journal together if posting fails after a real JE write', async () => {
    const { booking } = await createBooking();
    const original = depositTemplate.execute.bind(depositTemplate);
    const fault = jest.spyOn(depositTemplate, 'execute').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('Synthetic failure after posting');
    });
    try { await expect(pay(booking.id)).rejects.toThrow('Synthetic failure after posting'); }
    finally { fault.mockRestore(); }
    const stored = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('PENDING_DEPOSIT');
    expect(stored.depositPaidAt).toBeNull();
    expect(await readEntries(booking.id)).toHaveLength(0);
    await pay(booking.id);
    expect(await cashNet(booking.id)).toBe(1000);
  });

  it('rolls back item replacement if the same edit fails its customer foreign key', async () => {
    const { booking } = await createBooking();
    await expect(bookings.update(booking.id, { customerId: randomUUID(),
      items: [{ description: 'Synthetic replacement', quantity: 1, unitPrice: 5000 }] }, actor)).rejects.toThrow();
    const stored = await bookings.findOne(booking.id, actor);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].id).toBe(booking.items[0].id);
    expect(stored.totalAmount.toNumber()).toBe(10000);
  });
  it('allows only one of two bookings to sell the same physical device', async () => {
    const { booking: first, product } = await createBooking();
    const second = await bookings.create({ customerId, branchId, depositAmount: 1000,
      items: [{ productId: product.id, description: prefix, quantity: 1, unitPrice: 10000 }],
    }, actor.id, actor);
    await pay(first.id); await pay(second.id);
    const results = await Promise.allSettled([first, second].map(booking => bookings.convertToSale(
      booking.id, { collectBalance: true, paymentMethod: 'CASH' }, actor.id, actor)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await db.booking.findMany({ where: { id: { in: [first.id, second.id] } } });
    expect(stored.map(row => row.status).sort()).toEqual(['CONVERTED', 'PAID']);
    expect(await db.sale.count({ where: { productId: product.id } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('SOLD_CASH');
    const loser = stored.find(row => row.status === 'PAID')!;
    expect(await readEntries(loser.id)).toHaveLength(1);
    const winner = stored.find(row => row.status === 'CONVERTED')!;
    await expect(bookings.convertToSale(winner.id, { collectBalance: true, paymentMethod: 'CASH' }, actor.id, actor)).rejects.toThrow();
    expect(await db.sale.count({ where: { productId: product.id } })).toBe(1);
  });

  it.each(['foreign branch', 'damaged', 'quantity', 'multiple items'])('rolls back conversion for an ineligible booking: %s', async scenario => {
    const { booking, product } = await createBooking();
    await pay(booking.id);
    if (scenario === 'foreign branch') {
      const other = await db.branch.create({ data: { name: `${prefix}-other`, companyId: shopId } });
      await db.product.update({ where: { id: product.id }, data: { branchId: other.id } });
    } else if (scenario === 'damaged') {
      await db.product.update({ where: { id: product.id }, data: { wasPreviouslyDamaged: true } });
    } else if (scenario === 'quantity') {
      await db.bookingItem.updateMany({ where: { bookingId: booking.id }, data: { quantity: 2 } });
    } else {
      await db.bookingItem.create({ data: { bookingId: booking.id, description: 'legacy extra item', quantity: 1, unitPrice: 1, amount: 1 } });
    }
    await expect(bookings.convertToSale(booking.id, { collectBalance: true, paymentMethod: 'CASH', previouslyDamagedAcknowledged: true }, actor.id, actor)).rejects.toThrow();
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PAID');
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('IN_STOCK');
    expect(await db.sale.count({ where: { productId: product.id } })).toBe(0);
    expect(await readEntries(booking.id)).toHaveLength(1);
  });

  it.each([
    { depositMethod: 'CASH' as const, paymentMethod: 'BANK_TRANSFER' as const, deposit: 1000, cash: 1000, bank: 9000 },
    { depositMethod: 'BANK_TRANSFER' as const, paymentMethod: 'CASH' as const, deposit: 1000, cash: 9000, bank: 1000 },
    { depositMethod: 'QR_EWALLET' as const, paymentMethod: undefined, deposit: 10000, cash: 0, bank: 10000 },
  ])('keeps net tender amounts correct: $depositMethod then $paymentMethod', async scenario => {
    const { booking } = await createBooking();
    await bookings.update(booking.id, { depositAmount: scenario.deposit }, actor);
    await bookings.payDeposit(booking.id, { depositMethod: scenario.depositMethod }, actor);
    const stored = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.depositAccountCode).toBe(scenario.depositMethod === 'CASH' ? 'S11-1101' : 'S11-1201');
    const result = await bookings.convertToSale(booking.id, { collectBalance: scenario.deposit < 10000,
      paymentMethod: scenario.paymentMethod }, actor.id, actor);
    expect(result.sale.amountReceived?.toNumber()).toBe(10000);
    const journal = await db.journalEntry.findMany({ where: { deletedAt: null, OR: [
      { metadata: { path: ['bookingId'], equals: booking.id } },
      { metadata: { path: ['saleId'], equals: result.sale.id } },
    ] }, include: { lines: true } });
    expect(journal).toHaveLength(3);
    const net = (account: string) => journal.flatMap(row => row.lines).filter(line => line.accountCode === account)
      .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Decimal(0)).toNumber();
    expect(net('S11-1101')).toBe(scenario.cash);
    expect(net('S11-1201')).toBe(scenario.bank);
    expect(net('S21-2002')).toBe(0);
    expect(net('S41-1101')).toBe(-10000);
  });

  it('rejects an incorrect compatibility account without recording receipt metadata or JE', async () => {
    const { booking } = await createBooking();
    await expect(bookings.payDeposit(booking.id, { depositMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' }, actor)).rejects.toThrow(/บัญชี/);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).depositPaidAt).toBeNull();
    expect(await readEntries(booking.id)).toHaveLength(0);
  });

  it.each([false, true])('expires received=%s without allowing payment, conversion or extension at the cutoff', async received => {
    const { booking, product } = await createBooking();
    if (received) await pay(booking.id);
    const cutoff = new Date();
    await db.booking.update({ where: { id: booking.id }, data: { expireDate: cutoff } });
    const results = await Promise.allSettled([
      bookings.autoExpire(cutoff),
      bookings.update(booking.id, { expireDate: new Date(Date.now() + 86400000).toISOString() }, actor),
      received ? bookings.convertToSale(booking.id, { collectBalance: true, paymentMethod: 'CASH' }, actor.id, actor) : pay(booking.id),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('rejected');
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('EXPIRED');
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('IN_STOCK');
    expect(await readEntries(booking.id)).toHaveLength(received ? 2 : 0);
    expect(await cashNet(booking.id)).toBe(received ? 1000 : 0);
    await bookings.autoExpire(cutoff);
    expect(await readEntries(booking.id)).toHaveLength(received ? 2 : 0);
  });

  it('processes more than 500 expired rows despite one failing monetary posting, then retries it once', async () => {
    const { booking: failing } = await createBooking();
    await pay(failing.id);
    const cutoff = new Date();
    await db.booking.update({ where: { id: failing.id }, data: { expireDate: cutoff } });
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await db.booking.createMany({ data: ids.map(id => ({ id, bookingNumber: `${prefix}-bulk-${id}`,
      customerId, branchId, createdById: actor.id, depositAmount: 1000, totalAmount: 10000, expireDate: cutoff })) });
    const original = forfeitTemplate.execute.bind(forfeitTemplate);
    const failure = jest.spyOn(forfeitTemplate, 'execute').mockImplementation(async (input, tx) => {
      if (input.bookingId === failing.id) throw new Error('Synthetic forfeit failure');
      return original(input, tx);
    });
    try { expect(await bookings.autoExpire(cutoff)).toBe(501); } finally { failure.mockRestore(); }
    expect(await db.booking.count({ where: { id: { in: ids }, status: 'EXPIRED' } })).toBe(501);
    expect((await db.booking.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe('PAID');
    expect(await readEntries(failing.id)).toHaveLength(1);
    expect(await bookings.autoExpire(cutoff)).toBe(1);
    expect(await readEntries(failing.id)).toHaveLength(2);
    expect(await bookings.autoExpire(cutoff)).toBe(0);
  });

});
