import { TRADE_IN_DECLARATION_VERSION } from '@installment/shared';
import { Decimal } from '@prisma/client/runtime/library';
import { TradeInLifecycleService } from './trade-in-lifecycle.service';
import { ShopTradeInTemplate } from '../../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal tx object used inside $transaction callback */
function makeTx() {
  return {
    tradeIn: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    product: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', phone: '0000000000', addressCurrent: null }) },
    // B0 §2.1: autofill hook queries pricingTemplate — empty means NO_TEMPLATE,
    // returns before touching product.update/systemConfig, so this is all that's needed.
    pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradeInLifecycleService.accept() — SHOP JE wiring (Task 2)', () => {
  let service: TradeInLifecycleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: ReturnType<typeof makeTx>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopTradeInTemplate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopAccountResolver: any;

  beforeEach(() => {
    tx = makeTx();

    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };

    shopTradeInTemplate = {
      execute: jest.fn().mockResolvedValue({ entryNo: 'JE-001', journalEntryId: 'je-1' }),
    } as unknown as ShopTradeInTemplate;

    shopAccountResolver = {
      resolveOutflowCashAccount: jest.fn(),
    } as unknown as ShopAccountResolver;

    // Construct the service manually — it is a plain class (no @Injectable decorator),
    // so NestJS DI cannot inject its params; instantiation must happen directly.
    service = new TradeInLifecycleService(
      prisma,                                          // PrismaService
      { upload: jest.fn() } as any,                   // StorageService
      { allocate: jest.fn() } as any,                 // TradeInVoucherService
      { findOrCreateByNaturalKey: jest.fn() } as any, // ContactResolverService
      { hash: jest.fn() } as any,                     // CustomerPiiService
      { findOne: jest.fn(), checkImei: jest.fn() } as any, // TradeInQueryService
      { lookupValuation: jest.fn().mockResolvedValue({ found: false }) } as any, // TradeInValuationService
      shopTradeInTemplate,                             // ShopTradeInTemplate
      shopAccountResolver,                             // ShopAccountResolver
      { issue: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  // ─── Test 1: BUYBACK CASH → posts ShopTradeIn JE ─────────────────────────
  it('posts ShopTradeIn (Dr S11-2002 / Cr cash) for a BUYBACK accept (CASH → till)', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({
      id: 'ti-1',
      status: 'APPRAISED',
      deletedAt: null,
      flow: 'BUYBACK',
      branchId: 'br-1',
      offeredPrice: new Decimal(5000),
      estimatedValue: null,
      imei: null,
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 12',
      deviceColor: null,
      deviceStorage: null,
      deviceCondition: 'A',
      notes: null,
    });
    tx.product.create.mockResolvedValue({ id: 'p-new' });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-1', status: 'ACCEPTED' });
    shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1102');

    await service.accept(
      'ti-1',
      { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' } as any,
      'u-1',
    );

    expect(shopTradeInTemplate.execute).toHaveBeenCalledTimes(1);
    const input = shopTradeInTemplate.execute.mock.calls[0][0];
    expect(input).toMatchObject({
      idempotencyKey: 'shop-trade-in:ti-1',
      tradeInId: 'ti-1',
      cashAccountCode: 'S11-1102',
    });
    expect(input.tradeInPrice.toString()).toBe('5000');
    expect(input.inventoryAccountCode).toBeUndefined(); // defaults to S11-2002 inside template
    expect(shopTradeInTemplate.execute.mock.calls[0][1]).toBeDefined(); // tx passed
  });

  // ─── Test 2: EXCHANGE → does NOT post ShopTradeIn JE ─────────────────────
  it('does NOT post ShopTradeIn for an EXCHANGE accept', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({
      id: 'ti-2',
      status: 'APPRAISED',
      deletedAt: null,
      flow: 'EXCHANGE', customerId: 'cust-1',
      branchId: 'br-1',
      offeredPrice: new Decimal(5000),
      estimatedValue: null,
      imei: null,
      deviceBrand: 'A',
      deviceModel: 'B',
      deviceColor: null,
      deviceStorage: null,
      deviceCondition: null,
      notes: null,
    });
    tx.product.create.mockResolvedValue({ id: 'p-2' });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-2' });

    await service.accept(
      'ti-2',
      { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' } as any,
      'u-1',
    );

    expect(shopTradeInTemplate.execute).not.toHaveBeenCalled();
  });

  // ─── Test 3: BUYBACK TRANSFER → routes Cr to S11-1202 ────────────────────
  it('routes a BUYBACK TRANSFER payout to the paying bank S11-1202', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({
      id: 'ti-3',
      status: 'APPRAISED',
      deletedAt: null,
      flow: 'BUYBACK',
      branchId: 'br-1',
      offeredPrice: new Decimal(3000),
      estimatedValue: null,
      imei: null,
      deviceBrand: 'A',
      deviceModel: 'B',
      deviceColor: null,
      deviceStorage: null,
      deviceCondition: null,
      notes: null,
    });
    tx.product.create.mockResolvedValue({ id: 'p-3' });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-3' });
    shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1202');

    await service.accept(
      'ti-3',
      {
        sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true,
        sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==',
        paymentMethod: 'TRANSFER',
        transferBankName: 'KBank',
        transferAccountNumber: '123',
        transferAccountName: 'X',
      } as any,
      'u-1',
    );

    expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-1', 'TRANSFER', tx);
    expect(shopTradeInTemplate.execute.mock.calls[0][0].cashAccountCode).toBe('S11-1202');
  });

  // ─── Task 5: stock costPrice must not be inflated by EXCHANGE bonus ─────
  describe('accept costPrice (spec /sell §7.4)', () => {
    it('EXCHANGE instant: costPrice = cashPrice ไม่ใช่ราคารวมโบนัส', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({
        id: 'ti-4',
        status: 'APPRAISED',
        deletedAt: null,
        flow: 'EXCHANGE', customerId: 'cust-1',
        branchId: 'br-1',
        // offeredPrice = 13660 includes the EXCHANGE bonus on top of cashPrice —
        // stock cost must use the underlying cashPrice (12420), NOT this total.
        offeredPrice: new Decimal(13660),
        estimatedValue: null,
        imei: null,
        deviceBrand: 'Apple',
        deviceModel: 'iPhone 12',
        deviceColor: null,
        deviceStorage: null,
        deviceCondition: 'A',
        notes: null,
        quoteBreakdown: { cashPrice: '12420.00', chosenFlow: 'EXCHANGE' },
      });
      tx.product.create.mockResolvedValue({ id: 'p-4' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-4', status: 'ACCEPTED' });

      await service.accept(
        'ti-4',
        { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' } as any,
        'u-1',
      );

      const createArgs = tx.product.create.mock.calls[0][0];
      expect(createArgs.data.costPrice.toString()).toBe('12420');
    });

    it('BUYBACK instant: costPrice = offeredPrice (เงินที่จ่ายจริง) เหมือนเดิม', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({
        id: 'ti-5',
        status: 'APPRAISED',
        deletedAt: null,
        flow: 'BUYBACK',
        branchId: 'br-1',
        // offeredPrice deliberately differs from quoteBreakdown.cashPrice (owner manually
        // adjusted the payout) — BUYBACK cost MUST track the cash actually paid, not
        // the breakdown's cashPrice, otherwise the JE (posted from costPrice) would
        // no longer match the money that actually left the till.
        offeredPrice: new Decimal(12200),
        estimatedValue: null,
        imei: null,
        deviceBrand: 'A',
        deviceModel: 'B',
        deviceColor: null,
        deviceStorage: null,
        deviceCondition: null,
        notes: null,
        quoteBreakdown: { cashPrice: '12420.00', chosenFlow: 'BUYBACK' },
      });
      tx.product.create.mockResolvedValue({ id: 'p-5' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-5', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1102');

      await service.accept(
        'ti-5',
        { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' } as any,
        'u-1',
      );

      const createArgs = tx.product.create.mock.calls[0][0];
      expect(createArgs.data.costPrice.toString()).toBe('12200');
      // JE (if posted) must also reflect the same money actually paid
      expect(shopTradeInTemplate.execute.mock.calls[0][0].tradeInPrice.toString()).toBe('12200');
    });

    it('walk-in (ไม่มี quoteBreakdown): costPrice = offeredPrice เดิม', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({
        id: 'ti-6',
        status: 'APPRAISED',
        deletedAt: null,
        flow: 'EXCHANGE', customerId: 'cust-1',
        branchId: 'br-1',
        offeredPrice: new Decimal(8000),
        estimatedValue: null,
        imei: null,
        deviceBrand: 'A',
        deviceModel: 'B',
        deviceColor: null,
        deviceStorage: null,
        deviceCondition: null,
        notes: null,
        // no quoteBreakdown at all — legacy walk-in staff-appraised trade-in
      });
      tx.product.create.mockResolvedValue({ id: 'p-6' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-6', status: 'ACCEPTED' });

      await service.accept(
        'ti-6',
        { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' } as any,
        'u-1',
      );

      const createArgs = tx.product.create.mock.calls[0][0];
      expect(createArgs.data.costPrice.toString()).toBe('8000');
    });
  });

  describe('accept effectiveBranchId (launch-wave Track B)', () => {
    const ONLINE_NO_BRANCH = {
      id: 'ti-9',
      status: 'APPRAISED',
      deletedAt: null,
      flow: 'BUYBACK',
      branchId: null,
      offeredPrice: new Decimal(5000),
      estimatedValue: null,
      imei: null,
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 12',
      deviceColor: null,
      deviceStorage: null,
      deviceCondition: 'A',
      notes: null,
      quoteBreakdown: null,
      firstAppraisedAt: null,
    };
    const BASE_DTO = {
      sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true,
      sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==',
      paymentMethod: 'CASH' as const,
    };

    it('record ออนไลน์ (branchId null) + dto.branchId → product/JE/persist ใช้สาขาที่เลือก', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH });
      tx.product.create.mockResolvedValue({ id: 'p-1' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO, branchId: 'br-7' }, 'u1');

      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-7');
      expect(tx.tradeIn.update.mock.calls[0][0].data.branchId).toBe('br-7');
      expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-7', 'CASH', tx);
    });

    it('record ออนไลน์ไม่มีสาขา + ไม่ส่ง dto.branchId → 400', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH });
      await expect(service.accept('ti-9', { ...BASE_DTO }, 'u1')).rejects.toThrow(
        'รายการเทรดอินไม่มีข้อมูลสาขา — กรุณาเลือกสาขาที่รับเครื่อง',
      );
    });

    it('walk-in (branchId ผูกแล้ว) ไม่ส่ง dto → ใช้สาขาเดิม (back-compat)', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      tx.product.create.mockResolvedValue({ id: 'p-2' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO }, 'u1');

      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-1');
      expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-1', 'CASH', tx);
    });

    it('ผูกสาขาแล้ว + dto.branchId ต่างค่า → 400 รายการนี้ผูกสาขาแล้ว', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      await expect(
        service.accept('ti-9', { ...BASE_DTO, branchId: 'br-2' }, 'u1'),
      ).rejects.toThrow('รายการนี้ผูกสาขาแล้ว');
    });

    it('ผูกสาขาแล้ว + dto.branchId ค่าเดียวกัน → ผ่าน (idempotent)', async () => {
      tx.tradeIn.findUnique.mockResolvedValue({ ...ONLINE_NO_BRANCH, branchId: 'br-1' });
      tx.product.create.mockResolvedValue({ id: 'p-3' });
      tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
      shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1101');

      await service.accept('ti-9', { ...BASE_DTO, branchId: 'br-1' }, 'u1');
      expect(tx.product.create.mock.calls[0][0].data.branchId).toBe('br-1');
    });
  });
});

describe('TradeInLifecycleService.accept() — auto-mark เครื่องจากลูกค้าทดสอบ (spec 2026-09-05 §5.3)', () => {
  let service: TradeInLifecycleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let tx: ReturnType<typeof makeTx>;

  const baseTradeIn = {
    id: 'ti-1',
    status: 'APPRAISED',
    deletedAt: null,
    flow: 'BUYBACK',
    branchId: 'br-1',
    offeredPrice: new Decimal(5000),
    estimatedValue: null,
    imei: '359000000000001',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 12',
    deviceColor: null,
    deviceStorage: null,
    deviceCondition: 'A',
    notes: null,
  };
  const acceptDto = { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' };

  beforeEach(() => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    tx.product.create.mockResolvedValue({
      id: 'p-new',
      brand: 'Apple',
      model: 'iPhone 12',
      storage: null,
    });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-1', status: 'ACCEPTED' });
    service = new TradeInLifecycleService(
      prisma,
      { upload: jest.fn() } as any,
      { allocate: jest.fn() } as any,
      { findOrCreateByNaturalKey: jest.fn() } as any,
      { hash: jest.fn() } as any,
      { findOne: jest.fn(), checkImei: jest.fn() } as any,
      { lookupValuation: jest.fn().mockResolvedValue({ found: false }) } as any,
      {
        execute: jest.fn().mockResolvedValue({ entryNo: 'JE-001', journalEntryId: 'je-1' }),
      } as any,
      { resolveOutflowCashAccount: jest.fn().mockResolvedValue('S11-1102') } as any,
    );
  });

  it('ลูกค้าทดสอบ (ที่อยู่ = marker) → ชื่อเครื่องขึ้นต้น "ทดสอบระบบ "', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: 'cust-t' });
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-t',
      name: 'ทดสอบระบบ ลูกค้า',
      phone: '0890000000',
      addressCurrent: TEST_CUSTOMER_ADDRESS,
    });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    const data = tx.product.create.mock.calls[0][0].data;
    expect(data.name).toBe('ทดสอบระบบ Apple iPhone 12');
    expect(data.imeiSerial).toBe('359000000000001'); // IMEI ไม่ถูกแตะ
  });

  it('ลูกค้าจริง → ชื่อเครื่องไม่เปลี่ยน', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: 'cust-1' });
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
      phone: '0891234567',
      addressCurrent: 'กรุงเทพ',
    });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    expect(tx.product.create.mock.calls[0][0].data.name).toBe('Apple iPhone 12');
  });

  it('ผู้ขาย walk-in (ไม่มี customerId) → ไม่ query ลูกค้า ชื่อไม่เปลี่ยน', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: null });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    expect(tx.customer.findUnique).not.toHaveBeenCalled();
    expect(tx.product.create.mock.calls[0][0].data.name).toBe('Apple iPhone 12');
  });
});

describe('TradeInLifecycleService.accept() — ผูก contact ผู้ขาย keyless ด้วยเลขบัตร (Part E)', () => {
  const tradeIn = {
    id: 'ti-e', status: 'APPRAISED', deletedAt: null, flow: 'EXCHANGE', customerId: null,
    sellerContactId: 'contact-keyless', branchId: 'br-1', offeredPrice: new Decimal(5000),
    estimatedValue: null, imei: null, deviceBrand: 'A', deviceModel: 'B', deviceColor: null,
    deviceStorage: null, deviceCondition: null, notes: null,
  };
  const dto = { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH' };

  function setup(opts: { updateMany: jest.Mock; hash?: string | null }) {
    const tx = {
      ...makeTx(),
      contact: {
        findUnique: jest.fn().mockResolvedValue({ id: 'contact-keyless', deletedAt: null, isActive: true, nationalIdHash: null }),
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'contact-keyless', nationalIdHash: null })
          .mockResolvedValueOnce(null),
        updateMany: opts.updateMany,
      },
    };
    tx.tradeIn.findUnique.mockResolvedValue(tradeIn);
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
    const resolver = { findOrCreateByNaturalKey: jest.fn(), ensureRole: jest.fn().mockResolvedValue({ customerId: 'cust-stub' }) };
    const service = new TradeInLifecycleService(
      prisma as never, {} as never, {} as never, resolver as never,
      { hash: jest.fn().mockReturnValue(opts.hash === undefined ? 'nid-hash' : opts.hash) } as never,
      {} as never, {} as never, { execute: jest.fn() } as never, { resolveOutflowCashAccount: jest.fn() } as never,
      { issue: jest.fn() } as never,
    );
    return { service, tx, resolver };
  }

  it('อีกทรานแซกชันเติมเลขบัตรเดียวกันก่อน (P2002) → 409 ภาษาไทยให้ลองใหม่ ไม่สร้าง stub', async () => {
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    const { service, resolver } = setup({ updateMany: jest.fn().mockRejectedValue(p2002) });
    await expect(service.accept('ti-e', dto as never, 'u-1')).rejects.toMatchObject({
      status: 409,
      message: 'ผู้ติดต่อนี้ถูกสร้างพร้อมกัน กรุณาลองใหม่อีกครั้ง',
    });
    expect(resolver.ensureRole).not.toHaveBeenCalled();
  });

  it('contact ถูกเติมเลขบัตร/ลบระหว่างนั้น (updateMany = 0 แถว) → 409 ไม่เขียนทับ', async () => {
    const { service, resolver } = setup({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await expect(service.accept('ti-e', dto as never, 'u-1')).rejects.toMatchObject({ status: 409 });
    expect(resolver.ensureRole).not.toHaveBeenCalled();
  });

  function withHolder(
    tx: ReturnType<typeof setup>['tx'],
    customers: { holder: { id: string } | null; keyless: { id: string } | null },
  ) {
    tx.contact.findFirst = jest.fn()
      .mockResolvedValueOnce({ id: 'contact-keyless', nationalIdHash: null })
      .mockResolvedValueOnce({ id: 'contact-held' });
    Object.assign(tx.customer, {
      findFirst: jest.fn()
        .mockResolvedValueOnce(customers.holder)
        .mockResolvedValueOnce(customers.keyless),
    });
    tx.product.create.mockResolvedValue({ id: 'p-e' });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-e' });
  }

  it('ย้ายเครดิตไปลูกค้าเดิมที่เป็นลูกค้าทดสอบ → ชื่อเครื่องติด marker "ทดสอบระบบ" (เลือกจากลูกค้าเครดิตที่ resolve แล้ว)', async () => {
    const { service, tx, resolver } = setup({ updateMany: jest.fn() });
    withHolder(tx, { holder: { id: 'cust-test' }, keyless: null });
    resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'contact-held' });
    resolver.ensureRole.mockResolvedValue({ customerId: 'cust-test' });
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-test', name: 'ทดสอบระบบ ลูกค้า', phone: '0000000000',
      addressCurrent: TEST_CUSTOMER_ADDRESS, nationalIdHash: null, deletedAt: null, contactId: 'contact-held',
    });
    await service.accept('ti-e', dto as never, 'u-1');
    expect(resolver.ensureRole).toHaveBeenCalledWith(tx, 'contact-held', 'CUSTOMER');
    expect(tx.customer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust-test' } }));
    expect(tx.product.create.mock.calls[0][0].data.name).toBe('ทดสอบระบบ A B');
  });

  it('contact ที่ถือเลขยังไม่มีลูกค้า แต่ contact keyless มี stub แล้ว → คงรายการไว้ที่ contact เดิม ไม่สร้าง stub ตัวที่สอง', async () => {
    const updateMany = jest.fn();
    const { service, tx, resolver } = setup({ updateMany });
    withHolder(tx, { holder: null, keyless: { id: 'cust-old-stub' } });
    resolver.ensureRole.mockResolvedValue({ customerId: 'cust-old-stub' });
    await service.accept('ti-e', dto as never, 'u-1');
    expect(resolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(resolver.ensureRole).toHaveBeenCalledWith(tx, 'contact-keyless', 'CUSTOMER');
    expect(tx.tradeIn.update.mock.calls[0][0].data.sellerContactId).toBe('contact-keyless');
  });

  it('ไม่มี salt (hash = null) → ไม่แตะ contact · สร้าง stub ตามเดิม', async () => {
    const updateMany = jest.fn();
    const { service, tx, resolver } = setup({ updateMany, hash: null });
    tx.product.create.mockResolvedValue({ id: 'p-e' });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-e' });
    await service.accept('ti-e', dto as never, 'u-1');
    expect(updateMany).not.toHaveBeenCalled();
    expect(resolver.ensureRole).toHaveBeenCalledWith(tx, 'contact-keyless', 'CUSTOMER');
    expect(tx.tradeIn.update.mock.calls[0][0].data.sellerContactId).toBe('contact-keyless');
  });
});
