import { TRADE_IN_DECLARATION_VERSION, TRADE_IN_DECLARATION_TEXT, LEGACY_TRADE_IN_DECLARATION } from '@installment/shared';
import { randomUUID } from 'node:crypto';
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
import { seedTradeInAppraisal, seedTradeInShop, tradeInProviders } from './support/trade-in-fixture';
import { ProductPhotosService } from '../src/modules/quality-control/product-photos.service';
import { ProductsService } from '../src/modules/products/products.service';
import { ShopBuybackController } from '../src/modules/shop-buyback/shop-buyback.controller';
import { ShopBotDefenseGuard } from '../src/modules/shop-bot-defense/shop-bot-defense.guard';
import { REFERENCE_PRICING_CONFIG_KEY, ReferencePricingCatalog } from '../src/modules/shop-buyback/reference-pricing.types';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('Trade-in payout and product handoff with real PostgreSQL + SHOP journal', () => {
  const db = new PrismaService();
  let app: INestApplication;
  let fixture: Awaited<ReturnType<typeof seedTradeInShop>>;
  let actor: { id: string; role: string; branchId: string | null; accessibleCompanies: string[] };
  const payment = { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' };
  const pdf = jest.spyOn(VoucherPdfRenderer.prototype, 'htmlToPdf').mockResolvedValue(Buffer.from('%PDF-test'));

  beforeAll(async () => {
    await db.$connect();
    fixture = await seedTradeInShop(db, 'BUYBACK E2E BRANCH');
    await seedTradeInAppraisal(db);
    actor = { id: fixture.user.id, role: 'OWNER', branchId: null, accessibleCompanies: ['SHOP', 'FINANCE'] };
    const storage = { upload: async () => 'isolated/test-image' } as unknown as StorageService;
    const module = await Test.createTestingModule({
      controllers: [TradeInController, ShopBuybackController],
      providers: [{ provide: PrismaService, useValue: db }, ...tradeInProviders(db, storage)],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
      context.switchToHttp().getRequest().user = actor; return true;
    } }).overrideGuard(ExportEnabledGuard).useValue({ canActivate: () => false })
      .overrideGuard(ShopBotDefenseGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Bind the same IPv4 destination Supertest uses; Darwin permits a different IPv6 server on the same port.
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); pdf.mockRestore(); });

  const buy = (extra: Record<string, unknown> = {}) => request(app.getHttpServer()).post('/trade-ins/quick-buy').send({
    ...payment, requestId: randomUUID(), branchId: fixture.branch.id, sellerContactId: fixture.seller.id,
    sellerName: fixture.seller.name, deviceBrand: 'TEST', deviceModel: 'BUYBACK-DEVICE', agreedPrice: 5000, ...extra,
  });

  describe('device-first QuickBuy server pricing', () => {
    const answers = [
      { questionKey: 'local-screen', choiceIds: ['local-screen-cracked'] },
      { questionKey: 'local-battery', choiceIds: ['local-battery-worn'] },
      { questionKey: 'local-issues', choiceIds: [] },
    ];
    const device = { deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB', answers };
    const preview = (extra: Record<string, unknown> = {}) => request(app.getHttpServer()).post('/trade-ins/quick-buy/preview').send({ ...device, ...extra });
    const counts = async () => ({ tradeIns: await db.tradeIn.count(), contacts: await db.contact.count(),
      products: await db.product.count(), journals: await db.journalEntry.count() });

    it('previews without intake writes, purchases the canonical cash price and replays after a price change', async () => {
      const initial = await counts();
      const catalog = await request(app.getHttpServer()).get('/trade-ins/quick-buy/catalog').expect(200);
      expect(catalog.body.models).toContainEqual(expect.objectContaining({ model: 'iPhone 15' }));
      const questions = await request(app.getHttpServer()).get('/trade-ins/quick-buy/questions')
        .query({ model: 'iPhone 15', storage: '128GB' }).expect(200);
      expect(questions.body.questions.map((q: { key: string }) => q.key)).toEqual(['local-screen', 'local-battery', 'local-issues']);
      await request(app.getHttpServer()).get('/trade-ins/quick-buy/questions').expect(400);
      await preview({ answers: answers.slice(0, 2) }).expect(400);
      await preview({ deviceBrand: 'Samsung' }).expect(400);
      const quoted = await preview().expect(201);
      expect(quoted.body).toMatchObject({ price: '8100.00', cashPrice: '8100.00', grade: 'B', previewToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(await counts()).toEqual(initial);

      const payload = { ...device, agreedPrice: 8100, deviceCondition: 'B', requestId: randomUUID(), previewToken: quoted.body.previewToken };
      await buy({ ...payload, previewToken: undefined }).expect(400);
      expect((await buy({ ...payload, agreedPrice: 8200 }).expect(409)).body.code).toBe('QUICK_BUY_QUOTE_CHANGED');
      await buy({ ...payload, deviceCondition: 'A' }).expect(409);
      expect(await counts()).toEqual(initial);
      const bought = await buy(payload).expect(201);
      const row = await db.tradeIn.findUniqueOrThrow({ where: { id: bought.body.id }, include: { product: true } });
      expect(row).toMatchObject({ status: 'ACCEPTED', flow: 'BUYBACK', deviceCondition: 'B', appraisalLocked: true, appraisedById: actor.id });
      expect(row.offeredPrice!.toFixed(2)).toBe('8100.00');
      expect(row.agreedPrice!.toFixed(2)).toBe('8100.00');
      expect(row.basePriceAtAppraisal!.toFixed(2)).toBe('10000.00');
      expect(row.product!.costPrice.toFixed(2)).toBe('8100.00');
      expect(row.conditionAnswers).toEqual(quoted.body.conditionAnswers);
      expect(row.quoteBreakdown).toEqual(quoted.body.breakdown);

      const valuation = await db.tradeInValuation.findUniqueOrThrow({ where: { brand_model_storage_condition:
        { brand: 'Apple', model: 'iPhone 15', storage: '128GB', condition: 'A' } } });
      try {
        await db.tradeInValuation.update({ where: { id: valuation.id }, data: { basePrice: 11000 } });
        const afterPurchase = await counts();
        expect((await buy({ ...payload, requestId: randomUUID() }).expect(409)).body.code).toBe('QUICK_BUY_QUOTE_CHANGED');
        expect((await buy(payload).expect(201)).body).toEqual(bought.body);
        await buy({ ...payload, answers: [{ questionKey: 'local-screen', choiceIds: ['local-screen-intact'] }, ...answers.slice(1)] }).expect(409);
        expect(await counts()).toEqual(afterPurchase);
        expect(await db.tradeIn.count({ where: { quickBuyRequestId: payload.requestId } })).toBe(1);
        expect(await db.journalEntry.count({ where: { referenceId: `tradein:${row.id}` } })).toBe(1);
      } finally {
        await db.tradeInValuation.update({ where: { id: valuation.id }, data: { basePrice: valuation.basePrice } });
      }
    });

    it('requires SHOP, allows sales to preview, and keeps final intake within their branch', async () => {
      const original = actor;
      try {
        actor = { ...actor, accessibleCompanies: ['FINANCE'] };
        await request(app.getHttpServer()).get('/trade-ins/quick-buy/catalog').expect(403);
        await request(app.getHttpServer()).get('/trade-ins/quick-buy/questions').query({ model: 'iPhone 15', storage: '128GB' }).expect(403);
        await preview().expect(403);
        await buy().expect(403);
        actor = { ...actor, role: 'SALES', branchId: fixture.branch.id, accessibleCompanies: ['SHOP'] };
        const quote = await preview().expect(201);
        await buy({ ...device, agreedPrice: 8100, previewToken: quote.body.previewToken, branchId: randomUUID() }).expect(403);
        actor = { ...actor, role: 'ACCOUNTANT' };
        await preview().expect(403);
      } finally { actor = original; }
    });
  });

  describe('authenticated walk-in questionnaire appraisal', () => {
    const answers = [
      { questionKey: 'local-screen', choiceIds: ['local-screen-cracked'] },
      { questionKey: 'local-battery', choiceIds: ['local-battery-worn'] },
      { questionKey: 'local-issues', choiceIds: [] },
    ];
    const pending = (extra: Record<string, unknown> = {}) => db.tradeIn.create({ data: {
      deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB', deviceCondition: 'A',
      submissionSource: 'OFFLINE', flow: 'BUYBACK', branchId: fixture.branch.id, ...extra,
    } });
    const preview = (id: string, body: Record<string, unknown> = { answers }) => request(app.getHttpServer()).post(`/trade-ins/${id}/appraisal-preview`).send(body);

    it('previews and commits the same server price/grade, with one winning concurrent confirmation', async () => {
      const row = await pending();
      const questions = await request(app.getHttpServer()).get('/trade-ins/appraisal-questions').expect(200);
      expect(questions.body.questions.map((q: { key: string }) => q.key)).toEqual(['local-screen', 'local-battery', 'local-issues']);
      const result = await preview(row.id).expect(201);
      expect(result.body).toMatchObject({ price: '8100.00', grade: 'B', cashPrice: '8100.00' });
      expect((await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING_APPRAISAL');
      const confirmed = await Promise.all([0, 1].map(() => request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, previewToken: result.body.previewToken, deviceCondition: 'D' })));
      expect(confirmed.filter((r) => r.status === 200)).toHaveLength(1);
      expect(confirmed.filter((r) => r.status >= 400)).toHaveLength(1);
      const saved = await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved.status).toBe('APPRAISED');
      expect(saved.deviceCondition).toBe('B');
      expect(saved.offeredPrice!.toFixed(2)).toBe('8100.00');
      expect(saved.estimatedValue!.toFixed(2)).toBe('8100.00');
      expect(saved.basePriceAtAppraisal!.toFixed(2)).toBe('10000.00');
      expect(saved.quoteBreakdown).toMatchObject({ price: '8100.00', chosenFlow: 'BUYBACK' });
      expect(saved.conditionAnswers).toEqual(result.body.conditionAnswers);
      expect(saved.productId).toBeNull();
    });

    it('rejects incomplete MULTI answers, unsupported brands/storage and missing or stale price previews', async () => {
      const row = await pending();
      await preview(row.id, { answers: answers.slice(0, 2) }).expect(400);
      await preview((await pending({ deviceBrand: 'Samsung' })).id).expect(400);
      await preview((await pending({ deviceStorage: null })).id).expect(400);
      await request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`).send({ mode: 'REVISED', answers }).expect(409);
      const result = await preview(row.id).expect(201);
      await request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, previewToken: result.body.previewToken, offeredPrice: 1 }).expect(400);
      await db.tradeIn.update({ where: { id: row.id }, data: { notes: 'Updated after preview' } });
      await request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, previewToken: result.body.previewToken }).expect(409);
      expect((await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING_APPRAISAL');
    });

    it('requires SHOP and appraisal role, limits managers to own branch but allows unassigned online intake', async () => {
      const row = await pending();
      const originalActor = actor;
      try {
        actor = { ...actor, accessibleCompanies: ['FINANCE'] };
        await request(app.getHttpServer()).get('/trade-ins/appraisal-questions').expect(403);
        await preview(row.id).expect(403);
        await request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`).send({ mode: 'REVISED', answers }).expect(403);
        actor = { ...originalActor, role: 'SALES', branchId: fixture.branch.id };
        await preview(row.id).expect(403);
        actor = { ...originalActor, role: 'BRANCH_MANAGER', branchId: 'another-branch' };
        await preview(row.id).expect(403);
        actor = { ...actor, branchId: fixture.branch.id };
        await preview(row.id).expect(201);
        await preview((await pending({ branchId: null })).id).expect(403);
        await preview((await pending({ branchId: null, submissionSource: 'ONLINE' })).id).expect(201);
      } finally { actor = originalActor; }
    });

    it('retains EXCHANGE cash base and bonus separately in the saved appraisal', async () => {
      const row = await pending({ flow: 'EXCHANGE' });
      const result = await preview(row.id).expect(201);
      expect(result.body).toMatchObject({ cashPrice: '8100.00', exchangePrice: '8910.00', price: '8910.00' });
      const saved = await request(app.getHttpServer()).patch(`/trade-ins/${row.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, previewToken: result.body.previewToken }).expect(200);
      expect(saved.body.quoteBreakdown).toMatchObject({ cashPrice: '8100.00', exchangePrice: '8910.00', price: '8910.00', chosenFlow: 'EXCHANGE' });
    });
  });

  it('uses scoped reference profiles through public and staff APIs, keeps eligibility proof and preserves previous snapshots', async () => {
    const config = await db.systemConfig.findUnique({ where: { key: REFERENCE_PRICING_CONFIG_KEY } });
    const catalog: ReferencePricingCatalog = { version: 1, source: 'https://www.yellobe.com/buy/detail', capturedAt: '2026-09-08T14:00:00Z',
      profiles: { p: { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true, eligibilityText: 'เครื่องเปิดได้และไม่มีบัญชีล็อก', questions: [
        { id: 'ref-q1', key: 'warranty', title: 'ประกัน', selectType: 'SINGLE', choices: [{ id: 'ref-expired', label: 'หมดประกัน', deductType: 'FIXED', deductValue: '500' }] },
        { id: 'ref-q2', key: 'body', title: 'ตัวเครื่อง', selectType: 'SINGLE', choices: [{ id: 'ref-body', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' }] },
      ] } }, assignments: [{ model: 'iPhone 12', storage: '128GB', profileId: 'p' }] };
    const answers = [{ questionKey: 'warranty', choiceIds: ['ref-expired'] }, { questionKey: 'body', choiceIds: ['ref-body'] }];
    const body = { model: 'iPhone 12', storage: '128GB', answers, deviceEligibilityConfirmed: true };
    try {
      await db.tradeInValuation.upsert({ where: { brand_model_storage_condition: { brand: 'Apple', model: 'iPhone 12', storage: '128GB', condition: 'A' } },
        update: { basePrice: 5000, deletedAt: null }, create: { brand: 'Apple', model: 'iPhone 12', storage: '128GB', condition: 'A', basePrice: 5000 } });
      await db.systemConfig.upsert({ where: { key: REFERENCE_PRICING_CONFIG_KEY }, update: { value: JSON.stringify(catalog), deletedAt: null },
        create: { key: REFERENCE_PRICING_CONFIG_KEY, value: JSON.stringify(catalog) } });
      const questions = await request(app.getHttpServer()).get('/shop/buyback/questions').query({ model: 'iPhone 12', storage: '128GB' }).expect(200);
      expect(questions.body).toMatchObject({ profileId: 'p', eligibilityRequired: true });
      expect(questions.body.questions.map((q: { key: string }) => q.key)).toEqual(['warranty', 'body']);
      await request(app.getHttpServer()).get('/shop/buyback/questions').query({ model: 'iPhone 12', storage: '512GB' }).expect(400);
      await request(app.getHttpServer()).post('/shop/buyback/quote').send({ ...body, deviceEligibilityConfirmed: false }).expect(400);
      await request(app.getHttpServer()).post('/shop/buyback/submit').send({ ...body, sellerName: 'TEST SELLER', sellerPhone: '0000000000', deviceEligibilityConfirmed: false }).expect(400);
      const quote = await request(app.getHttpServer()).post('/shop/buyback/quote').send(body).expect(201);
      expect(quote.body).toMatchObject({ price: '3825.00', grade: 'C' });
      const quickDevice = { deviceBrand: 'Apple', deviceModel: body.model, deviceStorage: body.storage, answers };
      const quickQuestions = await request(app.getHttpServer()).get('/trade-ins/quick-buy/questions').query({ model: body.model, storage: body.storage }).expect(200);
      expect(quickQuestions.body.profileId).toBe('p');
      await request(app.getHttpServer()).post('/trade-ins/quick-buy/preview').send(quickDevice).expect(400);
      const quickPreview = await request(app.getHttpServer()).post('/trade-ins/quick-buy/preview')
        .send({ ...quickDevice, deviceEligibilityConfirmed: true }).expect(201);
      const quickBought = await buy({ ...quickDevice, deviceEligibilityConfirmed: true, previewToken: quickPreview.body.previewToken,
        agreedPrice: 3825, deviceCondition: 'C' }).expect(201);
      const quickRow = await db.tradeIn.findUniqueOrThrow({ where: { id: quickBought.body.id } });
      expect(quickRow.quoteBreakdown).toEqual(quickPreview.body.breakdown);
      expect(quickRow.conditionAnswers).toEqual(expect.arrayContaining([expect.objectContaining({
        questionKey: '__device_eligibility', confirmed: true, source: catalog.source, profileId: 'p', verifiedById: actor.id })]));
      const submitted = await request(app.getHttpServer()).post('/shop/buyback/submit').send({ ...body, sellerName: 'TEST SELLER', sellerPhone: '0000000000' }).expect(201);
      const online = await db.tradeIn.findUniqueOrThrow({ where: { id: submitted.body.id } });
      expect(online.conditionAnswers).toEqual(expect.arrayContaining([expect.objectContaining({ questionKey: '__device_eligibility', confirmed: true })]));

      const walkIn = await db.tradeIn.create({ data: { deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceStorage: '128GB', flow: 'BUYBACK',
        submissionSource: 'OFFLINE', branchId: fixture.branch.id } });
      const staffQuestions = await request(app.getHttpServer()).get('/trade-ins/appraisal-questions').query({ tradeInId: walkIn.id }).expect(200);
      expect(staffQuestions.body.profileId).toBe('p');
      await request(app.getHttpServer()).post(`/trade-ins/${walkIn.id}/appraisal-preview`).send({ answers }).expect(400);
      const preview = await request(app.getHttpServer()).post(`/trade-ins/${walkIn.id}/appraisal-preview`).send({ answers, deviceEligibilityConfirmed: true }).expect(201);
      const admin = await request(app.getHttpServer()).get('/trade-ins/buyback-questions').expect(200);
      expect(admin.body.reference.assignments).toEqual(catalog.assignments);
      const changed = structuredClone(catalog);
      changed.profiles.p.questions[1].choices[0].deductValue = '20';
      await db.systemConfig.update({ where: { key: REFERENCE_PRICING_CONFIG_KEY }, data: { value: JSON.stringify(changed) } });
      await request(app.getHttpServer()).patch(`/trade-ins/${walkIn.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, deviceEligibilityConfirmed: true, previewToken: preview.body.previewToken }).expect(409);
      const refreshed = await request(app.getHttpServer()).post(`/trade-ins/${walkIn.id}/appraisal-preview`).send({ answers, deviceEligibilityConfirmed: true }).expect(201);
      const saved = await request(app.getHttpServer()).patch(`/trade-ins/${walkIn.id}/appraise-online`)
        .send({ mode: 'REVISED', answers, deviceEligibilityConfirmed: true, previewToken: refreshed.body.previewToken }).expect(200);
      expect(saved.body.offeredPrice).toBe('3600');
      expect(saved.body.conditionAnswers).toEqual(expect.arrayContaining([expect.objectContaining({ questionKey: '__device_eligibility', verifiedById: actor.id })]));
      expect((await db.tradeIn.findUniqueOrThrow({ where: { id: online.id } })).quoteBreakdown).toEqual(online.quoteBreakdown);
      await request(app.getHttpServer()).patch(`/trade-ins/${online.id}/appraise-online`).send({ mode: 'AS_ANSWERED' }).expect(400);
      const asAnswered = await request(app.getHttpServer()).patch(`/trade-ins/${online.id}/appraise-online`)
        .send({ mode: 'AS_ANSWERED', deviceEligibilityConfirmed: true }).expect(200);
      expect(asAnswered.body.offeredPrice).toBe('3825');
      expect(asAnswered.body.conditionAnswers).toEqual(expect.arrayContaining([expect.objectContaining({ questionKey: '__device_eligibility', verifiedById: actor.id })]));
    } finally {
      await db.systemConfig.update({ where: { key: REFERENCE_PRICING_CONFIG_KEY }, data: config
        ? { value: config.value, deletedAt: config.deletedAt } : { deletedAt: new Date() } });
    }
  });

  it('returns the original purchase after a lost response instead of buying the device twice', async () => {
    const requestId = randomUUID();
    const first = await buy({ requestId }).expect(201);
    const replay = await buy({ requestId }).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await db.tradeIn.count({ where: { quickBuyRequestId: requestId } })).toBe(1);
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${first.body.id}` } })).toBe(1);
    await buy({ requestId, agreedPrice: 5100 }).expect(409);
  });

  it('allocates one stable voucher when replay and original request finish together', async () => {
    const created = await buy().expect(201);
    await db.tradeIn.update({ where: { id: created.body.id }, data: { voucherNumber: null, voucherDate: null } });
    const service = app.get(TradeInVoucherService);
    const results = await Promise.all([service.allocate(created.body.id), service.allocate(created.body.id)]);
    expect(results[0]).toEqual(results[1]);
  });

  it('requires seller identity and traceable device information before buying', async () => {
    await buy({ sellerIdCardNumber: undefined }).expect(400);
    await buy({ imei: undefined, serialNumber: undefined }).expect(400);
  });

  it.each([['CASH', 'S11-1102'], ['TRANSFER', 'S11-1202']])('records %s as BUYBACK, debits used stock and credits the SHOP source', async (method, code) => {
    const initialProducts = await db.product.count();
    const res = await buy({ paymentMethod: method, transferBankName: 'SELLER BANK',
      transferAccountNumber: '1234567890', transferAccountName: 'SELLER RECIPIENT', flow: 'EXCHANGE' }).expect(201);
    const tradeIn = await db.tradeIn.findUniqueOrThrow({ where: { id: res.body.id }, include: { product: true } });
    expect(tradeIn.flow).toBe('BUYBACK');
    expect(tradeIn.sellerDeclarationSnapshot).toEqual({
      version: TRADE_IN_DECLARATION_VERSION, text: TRADE_IN_DECLARATION_TEXT,
      acceptedAt: tradeIn.idCardVerifiedAt!.toISOString(), acceptedByUserId: actor.id,
    });
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
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${tradeIn.id}` } })).toBe(1);
    const vouchers = app.get(TradeInVoucherService);
    await vouchers.allocate(tradeIn.id);
    const document = await vouchers.renderPdf(tradeIn.id);
    expect(document.filename).toBe(`ใบรับเครื่องเทิร์น_${document.voucherNumber}.pdf`);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('ใบรับเครื่องเทิร์น');
    expect(html).toContain('การใช้เครดิตให้ตรวจจากใบขายหรือสัญญา');
    expect(html).toContain('มูลค่าเครื่อง 5,000.00 บาท + โบนัสส่วนลด 500.00 บาท');
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
    const document = await vouchers.renderPdf(tradeIn.id);
    expect(document.filename).toBe(`ใบสำคัญจ่ายเงิน_${document.voucherNumber}.pdf`);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('ใบสำคัญจ่ายเงิน');
    expect(html).toContain(method === 'CASH' ? 'รับเงินสด' : 'SELLER LEGACY BANK');
    expect(html).not.toContain('ยอดเครดิตที่ตกลง');
    expect(tradeIn.sellerDeclarationSnapshot).toBeNull();
    expect(html).toContain(LEGACY_TRADE_IN_DECLARATION);
    expect(html).not.toContain('ภาระจำนำ');
  });

  it('keeps IMEI and Serial separate through purchase, stock, search and printed evidence', async () => {
    const res = await buy({ imei: '359000000000081', serialNumber: '  BC-SN-00081  ' }).expect(201);
    const row = await db.tradeIn.findUniqueOrThrow({ where: { id: res.body.id }, include: { product: true } });
    expect(row).toMatchObject({ imei: '359000000000081', serialNumber: 'BC-SN-00081' });
    expect(row.product).toMatchObject({ imeiSerial: row.imei, serialNumber: row.serialNumber });
    const found = await request(app.getHttpServer()).get('/trade-ins').query({ search: 'bc-sn-00081' }).expect(200);
    expect(found.body.data.map((r: { id: string }) => r.id)).toContain(row.id);
    await db.product.update({ where: { id: row.productId! }, data: { serialNumber: 'LATER-STOCK-EDIT' } });
    await app.get(TradeInVoucherService).renderPdf(row.id);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('IMEI: 359000000000081<br>Serial Number: BC-SN-00081');
    expect(html).not.toContain('LATER-STOCK-EDIT');
    const before = await db.tradeIn.count();
    await buy({ serialNumber: 'X'.repeat(101) }).expect(400);
    await buy({ serialNumber: 12345 }).expect(400);
    expect(await db.tradeIn.count()).toBe(before);
  });

  it('captures identifiers at handoff and rejects duplicate IMEI before signing or creating stock', async () => {
    const draft = () => db.tradeIn.create({ data: { branchId: fixture.branch.id, sellerName: 'IDENTIFIER HANDOFF',
      deviceBrand: 'TEST', deviceModel: 'SERIAL', flow: 'EXCHANGE', status: 'APPRAISED', offeredPrice: 5000 } });
    const row = await draft();
    await request(app.getHttpServer()).post(`/trade-ins/${row.id}/accept`)
      .send({ ...payment, imei: '359000000000082', serialNumber: '  HANDOFF-SN-82  ' }).expect(201);
    const saved = await db.tradeIn.findUniqueOrThrow({ where: { id: row.id }, include: { product: true } });
    expect(saved).toMatchObject({ imei: '359000000000082', serialNumber: 'HANDOFF-SN-82' });
    expect(saved.product).toMatchObject({ imeiSerial: saved.imei, serialNumber: saved.serialNumber });
    const duplicate = await draft();
    const products = await db.product.count();
    await request(app.getHttpServer()).post(`/trade-ins/${duplicate.id}/accept`)
      .send({ ...payment, imei: saved.imei, serialNumber: 'DIFFERENT-SERIAL' }).expect(400);
    expect(await db.product.count()).toBe(products);
    expect(await db.tradeIn.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({
      status: 'APPRAISED', imei: null, serialNumber: null, sellerDeclarationSnapshot: null,
    });
  });

  it('rejects missing or stale terms and missing signatures before creating a purchase', async () => {
    const before = await db.tradeIn.count();
    await buy({ declarationVersion: undefined }).expect(400);
    await buy({ declarationVersion: 'obsolete' }).expect(400);
    await buy({ sellerSignatureBase64: undefined }).expect(400);
    await buy({ sellerSignatureBase64: '  ' }).expect(400);
    expect(await db.tradeIn.count()).toBe(before);
  });

  it('keeps signed evidence after forced reappraisal and renders the saved text verbatim', async () => {
    const res = await buy().expect(201);
    const accepted = await db.tradeIn.findUniqueOrThrow({ where: { id: res.body.id } });
    await db.tradeIn.update({ where: { id: accepted.id }, data: { status: 'APPRAISED' } });
    const productCount = await db.product.count();
    await request(app.getHttpServer()).post(`/trade-ins/${accepted.id}/accept`)
      .send({ ...payment, sellerSignatureBase64: 'replacement' }).expect(400);
    expect(await db.tradeIn.findUniqueOrThrow({ where: { id: accepted.id } })).toMatchObject({
      sellerDeclarationSnapshot: accepted.sellerDeclarationSnapshot,
      sellerSignatureBase64: accepted.sellerSignatureBase64,
    });
    expect(await db.product.count()).toBe(productCount);
    // Simulate a distinct previously accepted edition: the current catalog must not replace it.
    await db.tradeIn.update({ where: { id: accepted.id }, data: { sellerDeclarationSnapshot: {
      version: 'historical-test', text: 'ข้อความที่ลงนามไว้ <ตัวอย่าง>',
      acceptedAt: accepted.idCardVerifiedAt!.toISOString(), acceptedByUserId: actor.id,
    } } });
    await app.get(TradeInVoucherService).renderPdf(accepted.id);
    const html = pdf.mock.calls.at(-1)![0];
    expect(html).toContain('ข้อความที่ลงนามไว้ &lt;ตัวอย่าง&gt;');
    expect(html).not.toContain('ภาระจำนำ');
  });

  it('accepts only one concurrent signature and rolls back the losing stock/journal write', async () => {
    const row = await db.tradeIn.create({ data: { branchId: fixture.branch.id, sellerName: 'CONCURRENT SIGNING',
      deviceBrand: 'TEST', deviceModel: 'CONCURRENT', flow: 'BUYBACK', status: 'APPRAISED', offeredPrice: 5000 } });
    const productCount = await db.product.count();
    const results = await Promise.all([1, 2].map((n) => request(app.getHttpServer())
      .post(`/trade-ins/${row.id}/accept`).send({ ...payment, sellerSignatureBase64: `signature-${n}` })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await db.product.count()).toBe(productCount + 1);
    expect(await db.journalEntry.count({ where: { referenceId: `tradein:${row.id}` } })).toBe(1);
    const saved = await db.tradeIn.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.sellerSignatureBase64).toBe(`signature-${results.findIndex((r) => r.status === 201) + 1}`);
    expect(saved.sellerDeclarationSnapshot).toMatchObject({ version: TRADE_IN_DECLARATION_VERSION, text: TRADE_IN_DECLARATION_TEXT });
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
