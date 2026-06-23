import { Decimal } from '@prisma/client/runtime/library';
import { TradeInLifecycleService } from './trade-in-lifecycle.service';
import { ShopTradeInTemplate } from '../../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

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
      { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' } as any,
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
      flow: 'EXCHANGE',
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
      { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' } as any,
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
        idCardVerified: true,
        sellerConsentSigned: true,
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
});
