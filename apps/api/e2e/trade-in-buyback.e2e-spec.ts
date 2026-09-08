import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TradeInController } from '../src/modules/trade-in/trade-in.controller';
import { TradeInVoucherService } from '../src/modules/trade-in/services/voucher.service';
import { VoucherPdfRenderer } from '../src/modules/trade-in/services/voucher/voucher-pdf.renderer';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ExportEnabledGuard } from '../src/modules/settings/guards/export-enabled.guard';
import { StorageService } from '../src/modules/storage/storage.service';
import { seedTradeInShop, tradeInProviders } from './support/trade-in-fixture';
import { ProductPhotosService } from '../src/modules/quality-control/product-photos.service';
import { ProductsService } from '../src/modules/products/products.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('Trade-in payout and product handoff with real PostgreSQL + SHOP journal', () => {
  const db = new PrismaService();
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof seedTradeInShop>>;
  let actor: { id: string; role: string; branchId: string | null };
  const payment = { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' };
  const pdf = jest.spyOn(VoucherPdfRenderer.prototype, 'htmlToPdf').mockResolvedValue(Buffer.from('%PDF-test'));

  beforeAll(async () => {
    await db.$connect();
    fixture = await seedTradeInShop(db, 'BUYBACK E2E BRANCH');
    actor = { id: fixture.user.id, role: 'OWNER', branchId: null };
    const storage = { upload: async () => 'isolated/test-image' } as unknown as StorageService;
    const module = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [{ provide: PrismaService, useValue: db }, ...tradeInProviders(db, storage)],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
      context.switchToHttp().getRequest().user = actor; return true;
    } }).overrideGuard(ExportEnabledGuard).useValue({ canActivate: () => false }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); pdf.mockRestore(); });

  const buy = (extra: Record<string, unknown> = {}) => request(app.getHttpServer()).post('/trade-ins/quick-buy').send({
    ...payment, branchId: fixture.branch.id, sellerContactId: fixture.seller.id,
    sellerName: fixture.seller.name, deviceBrand: 'TEST', deviceModel: 'BUYBACK-DEVICE', agreedPrice: 5000, ...extra,
  });

  it.each([['CASH', 'S11-1102'], ['TRANSFER', 'S11-1202']])('records %s as BUYBACK, debits used stock and credits the SHOP source', async (method, code) => {
    const initialProducts = await db.product.count();
    const res = await buy({ paymentMethod: method, transferBankName: 'SELLER BANK',
      transferAccountNumber: '1234567890', transferAccountName: 'SELLER RECIPIENT', flow: 'EXCHANGE' }).expect(201);
    const tradeIn = await db.tradeIn.findUniqueOrThrow({ where: { id: res.body.id }, include: { product: true } });
    expect(tradeIn.flow).toBe('BUYBACK');
    expect(tradeIn.productId).toBe(res.body.productId);
    expect(tradeIn.product?.status).toBe('PHOTO_PENDING');
    expect(tradeIn.product?.costPrice.toString()).toBe('5000');
    expect(tradeIn.transferAccountName).toBe(method === 'TRANSFER' ? 'SELLER RECIPIENT' : null);
    const entries = await db.journalEntry.findMany({ where: { referenceId: `tradein:${tradeIn.id}` }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0].companyId).toBe(fixture.shop.id);
    expect(entries[0].lines.map((line) => [line.accountCode, line.debit.toString(), line.credit.toString()])).toEqual([
      ['S11-2002', '5000', '0'], [code, '0', '5000'],
    ]);
    await request(app.getHttpServer()).post(`/trade-ins/${tradeIn.id}/voucher`).expect(201);
    await request(app.getHttpServer()).post(`/trade-ins/${tradeIn.id}/voucher`).expect(201);
    await request(app.getHttpServer()).post(`/trade-ins/${tradeIn.id}/accept`).send(payment).expect(400);
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${tradeIn.id}` } })).toBe(1);
    expect(await db.product.count()).toBe(initialProducts + 1);
  });

  it('normalizes EXCHANGE to credit, clears bank details, excludes bonus from cost, and renders a credit receipt', async () => {
    const tradeIn = await db.tradeIn.create({ data: { branchId: fixture.branch.id, sellerName: 'TEST EXCHANGE',
      deviceBrand: 'TEST', deviceModel: 'EXCHANGE', flow: 'EXCHANGE', status: 'APPRAISED', offeredPrice: 5500,
      quoteBreakdown: { cashPrice: '5000', exchangePrice: '5500' } } });
    await request(app.getHttpServer()).post(`/trade-ins/${tradeIn.id}/accept`).send({ ...payment,
      paymentMethod: 'TRADE_IN_CREDIT', transferBankName: 'STALE BANK', transferAccountName: 'STALE', transferAccountNumber: '123' }).expect(201);
    const accepted = await db.tradeIn.findUniqueOrThrow({ where: { id: tradeIn.id }, include: { product: true } });
    expect(accepted).toMatchObject({ paymentMethod: 'TRADE_IN_CREDIT', transferAccountNumber: null, transferAccountNameEncrypted: null });
    expect(accepted.product?.costPrice.toString()).toBe('5000');
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${tradeIn.id}` } })).toBe(0);
    const vouchers = app.get(TradeInVoucherService);
    await vouchers.allocate(tradeIn.id);
    await vouchers.renderPdf(tradeIn.id);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('ใบรับเครื่องเทิร์น');
    expect(html).toContain('ยังไม่ยืนยันการนำเครดิตไปใช้');
    expect(html).not.toContain('รับเงินสด');
    expect(html).not.toContain('โอนเงิน');
  });

  it('rejects invalid price, missing recipient, and missing branch till before creating a record', async () => {
    const before = await db.tradeIn.count();
    await buy({ agreedPrice: 0 }).expect(400);
    await buy({ agreedPrice: -1 }).expect(400);
    await buy({ agreedPrice: 0.001 }).expect(400);
    await buy({ paymentMethod: 'TRANSFER' }).expect(400);
    await db.branch.update({ where: { id: fixture.branch.id }, data: { shopCashAccountCode: null } });
    try { await buy().expect(400); } finally {
      await db.branch.update({ where: { id: fixture.branch.id }, data: { shopCashAccountCode: 'S11-1102' } });
    }
    expect(await db.tradeIn.count()).toBe(before);
  });

  it.each(['CASH', 'TRANSFER'])('preserves a historical EXCHANGE record with an actual %s payout on reprint', async (method) => {
    const tradeIn = await db.tradeIn.create({ data: { branchId: fixture.branch.id, sellerName: 'LEGACY COUNTER',
      deviceBrand: 'TEST', deviceModel: 'LEGACY', flow: 'EXCHANGE', status: 'ACCEPTED', agreedPrice: 5000,
      paymentMethod: method, transferBankName: 'SELLER LEGACY BANK', transferAccountName: 'SELLER LEGACY', transferAccountNumber: '1234567890' } });
    const vouchers = app.get(TradeInVoucherService);
    await vouchers.allocate(tradeIn.id);
    await vouchers.renderPdf(tradeIn.id);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('ใบสำคัญจ่ายเงิน');
    expect(html).toContain(method === 'CASH' ? 'รับเงินสด' : 'SELLER LEGACY BANK');
    expect(html).not.toContain('ยอดเครดิตที่ตกลง');
  });

  it('returns the existing record ID when appraisal fails so staff can resume instead of creating another purchase', async () => {
    const valuation = await db.tradeInValuation.create({ data: { brand: 'TEST', model: 'BUYBACK-DEVICE', storage: 'TEST', condition: 'B', basePrice: 10000 } });
    try {
      const res = await buy({ deviceStorage: 'TEST', deviceCondition: 'B' }).expect(400);
      expect(res.body.tradeInId).toBeTruthy();
      expect(await db.tradeIn.findUniqueOrThrow({ where: { id: res.body.tradeInId } })).toMatchObject({
        flow: 'BUYBACK', status: 'PENDING_APPRAISAL', productId: null,
      });
      expect(await db.journalEntry.count({ where: { referenceId: `tradein:${res.body.tradeInId}` } })).toBe(0);
    } finally { await db.tradeInValuation.delete({ where: { id: valuation.id } }); }
  });

  it('keeps the real branch guard: SALES cannot buy into another branch', async () => {
    const before = await db.tradeIn.count();
    actor = { ...actor, role: 'SALES', branchId: 'another-branch' };
    try { await buy().expect(403); } finally { actor = { ...actor, role: 'OWNER', branchId: null }; }
    expect(await db.tradeIn.count()).toBe(before);
  });

  it('uses the existing photo and price gates before a received device enters stock', async () => {
    const res = await buy().expect(201);
    const productId = res.body.productId;
    const photos = new ProductPhotosService(db);
    const products = new ProductsService(db);
    await expect(photos.completePhotos(productId, actor.id)).rejects.toThrow();
    for (const angle of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      await photos.uploadPhoto(productId, angle, 'data:image/png;base64,aXNvbGF0ZWQtdGVzdA==', actor.id);
    }
    expect(await photos.completePhotos(productId, actor.id)).toMatchObject({ enteredStock: false, needsPrice: true });
    await products.update(productId, { cashPrice: 6000, installmentPrice: 6500 }, actor.id);
    expect(await photos.completePhotos(productId, actor.id)).toMatchObject({ enteredStock: true, status: 'IN_STOCK' });
  });
});
