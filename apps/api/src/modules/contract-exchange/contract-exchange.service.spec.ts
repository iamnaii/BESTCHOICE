import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractExchangeService } from './contract-exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

// Default user shape used by submit() tests after Fix 2 (issue #1086 item 2).
// SALES_BR1 matches the mock contract's branchId ('br-1') so legacy tests
// pass the in-service branch check. Specific tests override as needed.
const SALES_BR1 = { id: 'u-1', role: 'SALES', branchId: 'br-1' };
const SALES_BR2 = { id: 'u-2', role: 'SALES', branchId: 'br-2' };
const OWNER_USER = { id: 'owner-1', role: 'OWNER', branchId: null };

describe('ContractExchangeService.submit', () => {
  let service: ContractExchangeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contract: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
      contractExchangeRequest: { create: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { write: jest.fn() } },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: ExchangeEclReversalTemplate, useValue: {} },
        { provide: ShopInventoryTransferTemplate, useValue: { execute: jest.fn() } },
        { provide: ShopAccountResolver, useValue: { resolveProductAccounts: jest.fn() } },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('NotFoundException when old contract does not exist', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(NotFoundException);
  });

  it('BadRequestException when old contract is not ACTIVE', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'CANCELED',
      deletedAt: null,
    });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(BadRequestException);
  });

  it('BadRequestException when new product is not IN_STOCK', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
    });
    prisma.product.findUnique
      .mockResolvedValueOnce({
        id: 'op',
        brand: 'A',
        model: 'X',
        storage: '256',
        sellingPrice: '28000',
        status: 'SOLD_INSTALLMENT',
      })
      .mockResolvedValueOnce({
        id: 'np',
        brand: 'A',
        model: 'X',
        storage: '256',
        sellingPrice: '28000',
        status: 'SOLD_INSTALLMENT',
      });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/IN_STOCK/);
  });

  // Device Swap 2026-07: different model no longer rejects — it routes to PRICED,
  // which then demands buybackPrice (was: /รุ่นเดียวกัน/ same-model rejection).
  it('brand differs → routes PRICED: BadRequest "กรุณาระบุราคารับซื้อ" when no buybackPrice', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    prisma.product.findUnique
      .mockResolvedValueOnce({
        id: 'op',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '28000',
      })
      .mockResolvedValueOnce({
        id: 'np',
        brand: 'Samsung',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '28000',
        status: 'IN_STOCK',
      });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคารับซื้อ/);
  });

  // Device Swap 2026-07: price different from contract.sellingPrice no longer
  // rejects — it routes to PRICED (was: same-price rejection).
  it('newPrice ≠ contract.sellingPrice → routes PRICED: BadRequest when no buybackPrice', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    prisma.product.findUnique
      .mockResolvedValueOnce({
        id: 'op',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '28000',
      })
      .mockResolvedValueOnce({
        id: 'np',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '30000',
        status: 'IN_STOCK',
      });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคารับซื้อ/);
  });

  // Issue #1086 item 1 — silent bypass when the NEW product's price is null
  it('BadRequestException when new product has BOTH sellingPrice and installmentPrice null (no silent bypass)', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    prisma.product.findUnique
      .mockResolvedValueOnce({
        id: 'op',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '28000',
        installmentPrice: '28000',
      })
      .mockResolvedValueOnce({
        id: 'np',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: null,
        installmentPrice: null,
        status: 'IN_STOCK',
      });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคาเครื่องใหม่ไม่ถูกตั้งค่า/);
  });

  // Device Swap 2026-07: the OLD product's price no longer participates in
  // validation — mode detection keys off contract.sellingPrice instead
  // (price-list drift guard, spec §4). Null old-product price → MEMO still works.
  it('OLD product with null prices no longer blocks — routes MEMO off contract.sellingPrice', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    prisma.product.findUnique
      .mockResolvedValueOnce({
        id: 'op',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: null,
        installmentPrice: null,
      })
      .mockResolvedValueOnce({
        id: 'np',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256',
        sellingPrice: '28000',
        installmentPrice: '28000',
        status: 'IN_STOCK',
      });
    prisma.contractExchangeRequest.create.mockImplementation(async ({ data }: any) => ({
      id: 'req-memo',
      ...data,
    }));
    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np' },
      SALES_BR1,
    );
    expect(result.mode).toBe('MEMO');
  });

  // I6 (final review 2026-07-29) — submitted oldProductId must be the device
  // actually on the contract (a mismatch would return the WRONG device to SHOP
  // at finalize).
  it('BadRequestException when oldProductId does not match contract.productId', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'other-product',
      deletedAt: null,
      sellingPrice: '28000',
    });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow('เครื่องเดิมไม่ตรงกับสัญญา');
    expect(prisma.contractExchangeRequest.create).not.toHaveBeenCalled();
  });

  // Issue #1086 item 2 — in-service branch check
  it('ForbiddenException when SALES user from another branch tries to submit', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
    });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR2),
    ).rejects.toThrow(ForbiddenException);
  });

  // Task 8 carry-over from Task 7 review — buildPreview must be branch-scoped
  // (any SALES could previously read any contract's NCV/GL by UUID).
  it('ForbiddenException when SALES user from another branch calls buildPreview', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
    });
    await expect(service.buildPreview({ oldContractId: 'old' }, SALES_BR2)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('OWNER (cross-branch role) can submit for a contract in any branch', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-owner', status: 'PENDING' });

    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np' },
      OWNER_USER,
    );
    expect(result.id).toBe('req-owner');
  });

  it('creates PENDING request when all checks pass', async () => {
    prisma.contract.findUnique.mockResolvedValue({
      id: 'old',
      branchId: 'br-1',
      status: 'ACTIVE',
      productId: 'op',
      deletedAt: null,
      sellingPrice: '28000',
    });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np', conditionNote: 'good' },
      SALES_BR1,
    );

    expect(result.id).toBe('req-1');
    expect(prisma.contractExchangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldContractId: 'old',
          oldProductId: 'op',
          newProductId: 'np',
          status: 'PENDING',
          mode: 'MEMO',
          requestedById: 'u-1',
          conditionNote: 'good',
        }),
      }),
    );
  });
});

// ============================================================================
// submit() mode routing (Device Swap 2026-07) — Task 7
// MEMO = same model + newPrice equals contract.sellingPrice (no JE, no buyback).
// PRICED = everything else: requires buyback/condition/months, snapshots
// tier/ncv/plan, and auto-approves when tier resolves to AUTO.
// ============================================================================
describe('submit() mode routing (Device Swap 2026-07)', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let audit: any;

  const user = { id: 'u-1', role: 'SALES', branchId: 'br-1' };

  // oldContract.sellingPrice = 11000 (per brief fixture), interestRate 0.05/mo flat.
  // Carries the full column set approve() reads so the AUTO path can run end-to-end.
  const oldContract = {
    id: 'old-c',
    branchId: 'br-1',
    status: 'ACTIVE',
    productId: 'op',
    deletedAt: null,
    customerId: 'cust',
    salespersonId: 'sp',
    pdpaConsentId: null,
    planType: 'STORE_DIRECT',
    totalMonths: 12,
    sellingPrice: { toString: () => '11000' } as any,
    interestRate: { toString: () => '0.05' } as any,
    monthlyPayment: { toString: () => '1000' } as any,
    financedAmount: { toString: () => '10000' } as any,
    storeCommission: { toString: () => '1000' } as any,
    vatAmount: { toString: () => '1190' } as any,
    downPayment: { toString: () => '1000' } as any,
    advanceBalance: { toString: () => '0' } as any,
    creditBalance: { toString: () => '0' } as any,
  };
  const oldProduct = {
    id: 'op',
    brand: 'Apple',
    model: 'iPhone 15',
    storage: '256',
    sellingPrice: '11000',
  };
  // Same model + price 11000 = contract.sellingPrice → MEMO
  const sameNewProduct = {
    id: 'np',
    brand: 'Apple',
    model: 'iPhone 15',
    storage: '256',
    sellingPrice: '11000',
    status: 'IN_STOCK',
  };
  // Different model, price 10000 → PRICED (plan: financed 10000, commission 1000, vendorSum 11000)
  const diffNewProduct = {
    id: 'np2',
    brand: 'Apple',
    model: 'iPhone 16',
    storage: '256',
    sellingPrice: '10000',
    status: 'IN_STOCK',
  };

  const baseDto = { oldContractId: 'old-c', oldProductId: 'op', newProductId: 'np' };
  const pricedDtoWithoutBuyback = {
    oldContractId: 'old-c',
    oldProductId: 'op',
    newProductId: 'np2',
  };
  // buyback 8000 ≠ vendorSum 11000 (depositAccountCode คงไว้ในฟิกซ์เจอร์เพื่อพิสูจน์ว่ายัง "รับได้" แต่ไม่บังคับ/ไม่มีผล)
  const pricedDtoFull = {
    ...pricedDtoWithoutBuyback,
    buybackPrice: '8000',
    deviceCondition: 'B',
    newTotalMonths: 12,
    newInterestRate: '0.05',
    depositAccountCode: '11-1101',
  };

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(oldContract),
        findFirst: jest.fn().mockResolvedValue(null), // nextExchangeContractNumber
        create: jest.fn().mockResolvedValue({ id: 'new-c', contractNumber: 'EXCH-20260729-0001' }),
        update: jest.fn(),
      },
      product: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === 'op') return oldProduct;
          if (where.id === 'np') return sameNewProduct;
          if (where.id === 'np2') return diffNewProduct;
          return null;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      contractExchangeRequest: {
        // Echo data so tests can assert mode/tier/snapshots off the return value
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'req-1', ...data })),
        // Task 8: approve() pre-fetches the request for tier-role enforcement.
        // I7: pre-fetch now includes oldContract.branchId for branch scoping —
        // must match the SALES user's branch so the AUTO path passes the check.
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-1',
          deletedAt: null,
          mode: 'PRICED',
          approvalTier: 'AUTO',
          oldContract: { branchId: 'br-1' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'req-1',
          oldContractId: 'old-c',
          oldProductId: 'op',
          newProductId: 'np2',
          oldContract,
        }),
        update: jest.fn(),
      },
      systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: '15' }) },
      tradeInValuation: { findFirst: jest.fn().mockResolvedValue(null) },
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        count: jest.fn().mockResolvedValue(4),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      pDPAConsent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'cloned-pdpa' }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: ExchangeEclReversalTemplate, useValue: {} },
        { provide: ShopInventoryTransferTemplate, useValue: { execute: jest.fn() } },
        { provide: ShopAccountResolver, useValue: { resolveProductAccounts: jest.fn() } },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('same model + ราคาเท่า contract.sellingPrice → MEMO (ไม่มี buybackPrice)', async () => {
    // fixture: oldContract.sellingPrice = 11000, newProduct ราคา 11000 รุ่นเดียวกัน
    const result = await service.submit(baseDto, user);
    expect(result.mode).toBe('MEMO');
    // MEMO carries no PRICED snapshot fields
    const createData = prisma.contractExchangeRequest.create.mock.calls[0][0].data;
    expect(createData.buybackPrice).toBeUndefined();
    expect(createData.approvalTier).toBeUndefined();
  });

  it('MEMO + ส่ง buybackPrice มา → BadRequest ภาษาไทย', async () => {
    await expect(service.submit({ ...baseDto, buybackPrice: '8000' }, user)).rejects.toThrow(
      'MEMO',
    );
  });

  it('คนละรุ่น → PRICED: ไม่ส่ง buybackPrice → BadRequest "กรุณาระบุราคารับซื้อ"', async () => {
    await expect(service.submit(pricedDtoWithoutBuyback, user)).rejects.toThrow('ราคารับซื้อ');
  });

  // 2026-08-03 (คำสั่งเจ้าของ) — REVERSES the 2026-07-29 requirement:
  // เปลี่ยนเครื่องไม่มีการเคลื่อนไหวเงินสดในวัน finalize อีกแล้ว (A.3 ตั้งลูกหนี้
  // 11-2107 แทนขาเงินสด) และ penalty JE ถูกยกเลิกไปตั้งแต่ 2026-07-31 →
  // ไม่มีผู้อ่าน depositAccountCode เหลือในเส้นทางนี้ จึงต้องส่งคำขอได้โดยไม่ต้องเลือกบัญชี
  it('PRICED ไม่ส่ง depositAccountCode → ผ่าน (ไม่บังคับแล้ว) และบันทึกเป็น undefined', async () => {
    const { depositAccountCode: _drop, ...noDeposit } = pricedDtoFull;
    const result = await service.submit(noDeposit, user);
    expect(result.mode).toBe('PRICED');
    expect(prisma.contractExchangeRequest.create).toHaveBeenCalledTimes(1);
    const createData = prisma.contractExchangeRequest.create.mock.calls[0][0].data;
    expect(createData.depositAccountCode).toBeUndefined();
  });

  it('PRICED ครบ field → เก็บ tier/ncv/plan snapshot; tier REVIEW ไม่ auto-approve', async () => {
    // Empty ledger → NCV 0; buyback 8000 ≥ NCV but no TradeInValuation row
    // (basePrice null) → REVIEW per the approval matrix.
    const result = await service.submit(pricedDtoFull, user);
    expect(result.mode).toBe('PRICED');
    expect(result.approvalTier).toBe('REVIEW');
    expect(result.status).toBe('PENDING');
    // Plan snapshot is server-computed (workbook golden: 10000/12 @0.05 → 1515.83)
    expect(result.newMonthlyPayment.toString()).toBe('1515.83');
    expect(result.newStoreCommission.toString()).toBe('1000');
    expect(result.newVatAmount.toString()).toBe('1190');
    expect(result.ncvSnapshot.toString()).toBe('0');
    expect(result.autoApproved).toBeUndefined();
  });

  it('tier AUTO → auto-approve ทันที (status APPROVED + newContractId)', async () => {
    // basePrice 8000 → marketMin 6800; buyback 8000 ≥ NCV(0) และ ≥ 6800 → AUTO
    prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: '8000' });
    const result = await service.submit(pricedDtoFull, user);
    expect(result.autoApproved).toBe(true);
    expect(result.status).toBe('APPROVED');
    expect(result.newContractId).toBeDefined();
    expect(result.newContractId).toBe('new-c');
  });

  // Task 2 review fix (2026-08-19) — expectedPl ใน preview ต้องตรง plug วิธีสุทธิ
  // ของ ExchangeCloseOld21_1106Template (A.2 NET method): diff = (buyback +
  // unearned + deferredVat) − (gross + vatRec + vatRec). สูตร gross เดิม
  // (buyback − grossInclVat) ทำให้ผู้อนุมัติเห็นขาดทุน 4,126.68 ขณะ JE จริงลง
  // เพียง 126.68 (fixture Case 2A) — preview ≠ posted ขัด payoff-parity doctrine.
  it('buildPreview expectedPl = plug วิธีสุทธิของ A.2 (Case 2A: −126.68 ไม่ใช่ −4,126.68)', async () => {
    // Ledger สัญญาเดิม (ค่าชุดเดียวกับ Case 2A integration fixture):
    // gross 11,333.36 / vatRec 793.32 / unearned 4,000.00 / deferredVat 793.32.
    // buildPreview เรียก journalLine.findMany 3 ครั้ง: #1 computeOldOutstanding
    // (fixture นี้), #2-#3 guard glContractBalance 11-2103/21-1103 (default []).
    prisma.journalLine.findMany.mockResolvedValueOnce([
      { accountCode: '11-2101', debit: '11333.36', credit: '0' },
      { accountCode: '11-2105', debit: '793.32', credit: '0' },
      { accountCode: '11-2106', debit: '0', credit: '4000.00' },
      { accountCode: '21-2102', debit: '0', credit: '793.32' },
    ]);

    const result = await service.buildPreview(
      { oldContractId: 'old-c', buybackPrice: '8000', deviceCondition: 'B' },
      user,
    );

    // (8,000 + 4,000 + 793.32) − (11,333.36 + 793.32 + 793.32) = −126.68
    expect(result.expectedPl).toBe('-126.68');
    // สูตร gross เดิมคือ buyback − grossRemainingInclVat = 8,000 − 12,126.68 = −4,126.68
    expect(result.grossRemainingInclVat).toBe('12126.68');
  });
});

// ============================================================================
// approve() — SP2 v2 sign-then-activate flow
// approve() ONLY creates a DRAFT contract + reserves the new product + flips
// the request to APPROVED. It does NOT post JEs or flip the old contract /
// product. The JE chain + old-side flips are tested under finalizeAfterActivation
// below.
// ============================================================================
describe('ContractExchangeService.approve (sign-then-activate)', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let templates: any;
  let audit: any;
  let companyResolver: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contractExchangeRequest: {
        // Task 8: approve() pre-fetches the request (tier-role enforcement +
        // MEMO/PRICED routing). These legacy tests are all PRICED/REVIEW.
        // I7: oldContract.branchId included for branch scoping (OWNER callers
        // skip the check, but the shape mirrors the real include).
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          deletedAt: null,
          mode: 'PRICED',
          approvalTier: 'REVIEW',
          oldContract: { branchId: 'br' },
        }),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      contract: {
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null), // for nextExchangeContractNumber
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: { count: jest.fn() },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
      },
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
      pDPAConsent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'cloned-pdpa-uuid' }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    templates = {
      t1a: { execute: jest.fn() },
      t2: { execute: jest.fn() },
      t3: { execute: jest.fn() },
      t4: { execute: jest.fn() },
      t5: { execute: jest.fn() },
      shopInv: { execute: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };
    companyResolver = { getShopCompanyId: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: templates.t3 },
        { provide: ShopExchangeReturnTemplate, useValue: templates.t4 },
        { provide: ExchangeEclReversalTemplate, useValue: templates.t5 },
        { provide: ShopInventoryTransferTemplate, useValue: templates.shopInv },
        {
          provide: ShopAccountResolver,
          useValue: {
            resolveProductAccounts: jest
              .fn()
              .mockReturnValue({
                inventoryAccountCode: 'S11-2001',
                cogsAccountCode: 'S50-1101',
                revenueAccountCode: 'S41-1101',
              }),
          },
        },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('throws ConflictException when lock returns count=0', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow(/อาจถูกอนุมัติแล้ว/);
  });

  it('creates DRAFT new contract + reserves new product + APPROVED workflow + audit (no JE, no old-side flips)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old-c',
      oldProductId: 'old-p',
      newProductId: 'new-p',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'new-c', contractNumber: 'EXCH-20260524-0001' });

    const result = await service.approve(
      'r1',
      { id: 'owner-1', role: 'OWNER', branchId: null },
      {},
    );

    // New contract created as DRAFT + workflowStatus APPROVED (sign-then-activate gate)
    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.status).toBe('DRAFT');
    expect(createData.workflowStatus).toBe('APPROVED');
    expect(createData.exchangedFromContractId).toBe('old-c');

    // New product reserved
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'new-p' },
        data: expect.objectContaining({ status: 'RESERVED' }),
      }),
    );

    // Request linked to new contract
    expect(prisma.contractExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ newContractId: 'new-c' }),
      }),
    );

    // NO JE posted, NO old contract flip, NO old product flip
    expect(templates.t1a.execute).not.toHaveBeenCalled();
    expect(templates.t2.execute).not.toHaveBeenCalled();
    expect(templates.t3.execute).not.toHaveBeenCalled();
    expect(templates.t4.execute).not.toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled();
    // Only the new-product update fired; old product should NOT have been touched.
    const updatedProductIds = (prisma.product.update.mock.calls as any[]).map(
      (c) => c[0]?.where?.id,
    );
    expect(updatedProductIds).not.toContain('old-p');

    // Audit log — phase tag highlights "no money has moved yet"
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_REQUEST_APPROVED',
        newValue: expect.objectContaining({
          phase: 'awaiting-sign-then-activate',
        }),
      }),
    );

    expect(result).toEqual({ id: 'r1', newContractId: 'new-c', mode: 'PRICED' });
  });

  it('clones PDPA consent from old contract for new contract (unique constraint workaround)', async () => {
    // Contract.pdpaConsentId is @unique so we can't reuse the old contract's
    // consent row. Service clones into a new row so the new contract gets
    // a fresh consent id while preserving the customer's consent semantics.
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    const old = { ...makeOldContract(12, 4), pdpaConsentId: 'pdpa-old-123' };
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: old,
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.pDPAConsent.findUnique.mockResolvedValue({
      id: 'pdpa-old-123',
      customerId: 'cust-1',
      consentVersion: 'v1.0',
      privacyNoticeText: 'Notice',
      purposes: ['CONTRACT_PROCESSING'],
      status: 'GRANTED',
      grantedAt: new Date('2026-01-01'),
      ipAddress: '127.0.0.1',
      deviceInfo: null,
      signatureImage: null,
    });
    prisma.pDPAConsent.create.mockResolvedValue({ id: 'pdpa-cloned-456' });
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

    expect(prisma.pDPAConsent.findUnique).toHaveBeenCalledWith({
      where: { id: 'pdpa-old-123' },
    });
    expect(prisma.pDPAConsent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          consentVersion: 'v1.0',
          status: 'GRANTED',
        }),
      }),
    );

    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.pdpaConsentId).toBe('pdpa-cloned-456');
    expect(createData.pdpaConsentId).not.toBe('pdpa-old-123');
  });

  it('sets pdpaConsentId=null when old contract has no consent', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    const old = { ...makeOldContract(12, 4), pdpaConsentId: null };
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: old,
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

    expect(prisma.pDPAConsent.findUnique).not.toHaveBeenCalled();
    expect(prisma.pDPAConsent.create).not.toHaveBeenCalled();
    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.pdpaConsentId).toBeNull();
  });

  it('creates new contract with remaining-installment plan (8 of 12)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.totalMonths).toBe(8);
  });

  it('throws when old contract fully paid (remaining <= 0)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: makeOldContract(12, 12),
    });
    prisma.payment.count.mockResolvedValue(12);

    await expect(
      service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow(/จ่ายครบงวด/);
  });

  // Issue #1086 item 5 — new contract must have downPayment=0
  it('new contract is created with downPayment=0 even when old contract had a non-zero downPayment', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: makeOldContract(12, 4), // makeOldContract sets downPayment=4000
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

    const createData = prisma.contract.create.mock.calls[0][0].data;
    // The new contract's downPayment must be a zero Decimal, not the old 4000.
    expect(createData.downPayment.toString()).toBe('0');
  });

  // Task 8 review fix 1 — legacy fallback must pass vatAmount null THROUGH,
  // not coerce to Decimal(0): ExchangeNewContract1ATemplate treats null as
  // "derive 7%" but 0 as "book zero VAT".
  it('legacy fallback: old.vatAmount null → contract.create receives vatAmount null (not 0)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1',
      oldContractId: 'old',
      oldProductId: 'op',
      newProductId: 'np',
      oldContract: { ...makeOldContract(12, 4), vatAmount: null },
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.vatAmount).toBeNull();
  });

  // Issue #1086 item 4 — EXCH-YYYYMMDD-NNNN doc number (no EX-${Date.now()} collision)
  describe('contract number (Issue #1086 item 4)', () => {
    beforeEach(() => {
      prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'r1',
        oldContractId: 'old',
        oldProductId: 'op',
        newProductId: 'np',
        oldContract: makeOldContract(12, 4),
      });
      prisma.payment.count.mockResolvedValue(4);
      prisma.contract.create.mockImplementation(async ({ data }: any) => ({
        id: 'nc',
        contractNumber: data.contractNumber,
      }));
    });

    it('uses EXCH-YYYYMMDD-NNNN format (NOT EX-<timestamp>)', async () => {
      prisma.contract.findFirst.mockResolvedValue(null); // first of the day
      const result = await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});
      const createData = prisma.contract.create.mock.calls[0][0].data;
      expect(createData.contractNumber).toMatch(/^EXCH-\d{8}-\d{4}$/);
      // Must NOT collide with ExpenseDocument EX- prefix:
      expect(createData.contractNumber).not.toMatch(/^EX-\d+$/);
      expect(result.newContractId).toBe('nc');
    });

    it('acquires advisory lock per BKK day', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
      );
    });

    it('increments sequence within the same BKK day', async () => {
      // Simulate three sequential approvals on the same day:
      const seqs: string[] = [];
      let pretendCount = 0;
      prisma.contract.findFirst.mockImplementation(async () =>
        pretendCount === 0
          ? null
          : { contractNumber: `EXCH-${todayBkk()}-${String(pretendCount).padStart(4, '0')}` },
      );
      prisma.contract.create.mockImplementation(async ({ data }: any) => {
        pretendCount += 1;
        seqs.push(data.contractNumber);
        return { id: `nc-${pretendCount}`, contractNumber: data.contractNumber };
      });

      await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});
      await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});
      await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});

      expect(seqs[0]).toMatch(/^EXCH-\d{8}-0001$/);
      expect(seqs[1]).toMatch(/^EXCH-\d{8}-0002$/);
      expect(seqs[2]).toMatch(/^EXCH-\d{8}-0003$/);
    });

    it('pads sequence to 4 digits past 99', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        contractNumber: `EXCH-${todayBkk()}-0099`,
      });
      await service.approve('r1', { id: 'u1', role: 'OWNER', branchId: null }, {});
      const createData = prisma.contract.create.mock.calls[0][0].data;
      expect(createData.contractNumber).toMatch(/^EXCH-\d{8}-0100$/);
    });
  });
});

// ============================================================================
// approve() tier authorization + MEMO apply (Device Swap 2026-07) — Task 8
// approve() now pre-fetches the request (outside the tx) for tier-role
// enforcement, then routes: MEMO → in-place product swap on the old contract
// (no JE, no new contract); PRICED → the SP2 tx body with the plan sourced
// from the submit-time snapshot (legacy fallback clones remaining months).
// ============================================================================
describe('approve() tier authorization + MEMO apply (Device Swap 2026-07)', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let templates: any;
  let audit: any;
  let companyResolver: any;
  let requests: Record<string, any>;

  beforeEach(async () => {
    const oldContract = makeOldContract(12, 4);
    requests = {
      // PRICED + ESCALATE — only OWNER may approve
      req1: {
        id: 'req1',
        deletedAt: null,
        status: 'PENDING',
        mode: 'PRICED',
        approvalTier: 'ESCALATE',
        oldContractId: 'old-c',
        oldProductId: 'old-p',
        newProductId: 'new-p',
        oldContract,
        newProduct: { id: 'new-p', installmentPrice: { toString: () => '10000' } },
      },
      // PRICED + REVIEW — BM may approve (legacy row: no plan snapshot → clone fallback)
      req2: {
        id: 'req2',
        deletedAt: null,
        status: 'PENDING',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
        oldContractId: 'old-c',
        oldProductId: 'old-p',
        newProductId: 'new-p',
        oldContract,
        newProduct: { id: 'new-p', installmentPrice: { toString: () => '10000' } },
      },
      // MEMO — same model + same price, no JE
      memoReq: {
        id: 'memoReq',
        deletedAt: null,
        status: 'PENDING',
        mode: 'MEMO',
        approvalTier: null,
        oldContractId: 'oldC1',
        oldProductId: 'oldP1',
        newProductId: 'newP1',
        oldContract: { ...oldContract, id: 'oldC1' },
      },
      // PRICED + REVIEW with full submit-time plan snapshot (Device Swap 2026-07)
      pricedReq: {
        id: 'pricedReq',
        deletedAt: null,
        status: 'PENDING',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
        oldContractId: 'old-c',
        oldProductId: 'old-p',
        newProductId: 'new-p',
        oldContract,
        newProduct: { id: 'new-p', installmentPrice: { toString: () => '10000' } },
        newTotalMonths: 12,
        newMonthlyPayment: { toString: () => '1515.83' },
        newInterestTotal: { toString: () => '6000' },
        newInterestRate: { toString: () => '0.05' },
        newVatAmount: { toString: () => '1190' },
        newStoreCommission: { toString: () => '1000' },
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contractExchangeRequest: {
        findUnique: jest
          .fn()
          .mockImplementation(async ({ where }: any) => requests[where.id] ?? null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
          const row = requests[where.id];
          if (!row) throw new Error(`no fixture for ${where.id}`);
          return row;
        }),
        update: jest.fn(),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null), // nextExchangeContractNumber
        create: jest.fn().mockResolvedValue({ id: 'new-c', contractNumber: 'EXCH-20260729-0001' }),
        update: jest.fn(),
      },
      payment: { count: jest.fn().mockResolvedValue(4) },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
      },
      pDPAConsent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'cloned-pdpa' }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    templates = {
      t1a: { execute: jest.fn() },
      t2: { execute: jest.fn() },
      t3: { execute: jest.fn() },
      t4: { execute: jest.fn() },
      t5: { execute: jest.fn() },
      shopInv: { execute: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };
    companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id') };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: templates.t3 },
        { provide: ShopExchangeReturnTemplate, useValue: templates.t4 },
        { provide: ExchangeEclReversalTemplate, useValue: templates.t5 },
        { provide: ShopInventoryTransferTemplate, useValue: templates.shopInv },
        {
          provide: ShopAccountResolver,
          useValue: {
            resolveProductAccounts: jest
              .fn()
              .mockReturnValue({
                inventoryAccountCode: 'S11-2001',
                cogsAccountCode: 'S50-1101',
                revenueAccountCode: 'S41-1101',
              }),
          },
        },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('NotFoundException when request does not exist', async () => {
    await expect(
      service.approve('missing', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('ESCALATE tier + role BRANCH_MANAGER → Forbidden', async () => {
    await expect(
      service.approve('req1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'br' }, {}),
    ).rejects.toThrow('OWNER');
    // Blocked BEFORE any state change — no tx, no lock
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('ESCALATE tier + role OWNER → ผ่าน', async () => {
    await expect(
      service.approve('req1', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).resolves.toBeDefined();
  });

  it('REVIEW tier + BRANCH_MANAGER → ผ่าน', async () => {
    await expect(
      service.approve('req2', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'br' }, {}),
    ).resolves.toBeDefined();
  });

  // I7 (final review 2026-07-29) — BM must not approve another branch's request
  it('BRANCH_MANAGER ต่างสาขา → Forbidden ก่อนแตะ state ใดๆ', async () => {
    await expect(
      service.approve('req2', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'br-OTHER' }, {}),
    ).rejects.toThrow('สาขาอื่น');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('OWNER (cross-branch) อนุมัติคำขอสาขาไหนก็ได้', async () => {
    await expect(
      service.approve('req2', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).resolves.toBeDefined();
  });

  it('MEMO: checklist ไม่ครบ → BadRequest', async () => {
    await expect(
      service.approve(
        'memoReq',
        { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'br' },
        { memoAddendumSigned: true },
      ),
    ).rejects.toThrow('checklist');
    // Guard fires OUTSIDE the tx — no lock attempted
    expect(prisma.contractExchangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('MEMO: checklist ครบ → เปลี่ยน productId บนสัญญาเดิม, ไม่สร้างสัญญาใหม่, ไม่มี JE', async () => {
    const result = await service.approve(
      'memoReq',
      { id: 'u1', role: 'OWNER', branchId: null },
      {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      },
    );
    expect(result.newContractId).toBeNull();
    expect(result.mode).toBe('MEMO');
    // Old contract now points at the new product — same schedule, same status
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldC1' },
        data: expect.objectContaining({ productId: 'newP1' }),
      }),
    );
    // Lock stamps memoAppliedAt alongside APPROVED
    expect(prisma.contractExchangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'memoReq', status: 'PENDING' }),
        data: expect.objectContaining({
          status: 'APPROVED',
          memoAppliedAt: expect.any(Date),
        }),
      }),
    );
    // New product inherits old device's status/ownership; old device back to SHOP
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'newP1' },
        data: expect.objectContaining({
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: 'finance-co-id',
        }),
      }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldP1' },
        data: expect.objectContaining({
          status: 'REFURBISHED',
          ownedByCompanyId: 'shop-co-id',
        }),
      }),
    );
    // No new contract, no JE templates
    expect(prisma.contract.create).not.toHaveBeenCalled();
    expect(templates.t1a.execute).not.toHaveBeenCalled();
    expect(templates.t2.execute).not.toHaveBeenCalled();
    expect(templates.t3.execute).not.toHaveBeenCalled();
    expect(templates.t4.execute).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_MEMO_APPLIED',
        entity: 'contract_exchange_request',
        entityId: 'memoReq',
      }),
    );
  });

  it('MEMO: B5 — ตัด hold ของเว็บใน tx เดียวกับที่เครื่องใหม่ออกจาก IN_STOCK (dynamic status flip)', async () => {
    prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.approve(
      'memoReq',
      { id: 'u1', role: 'OWNER', branchId: null },
      {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      },
    );

    const call = prisma.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId.in).toContain('newP1');
    expect(call.where.status).toBe('ACTIVE');
    expect(call.data).toEqual({ status: 'PREEMPTED' });
  });

  it('PRICED: สัญญาใหม่ใช้แผนจาก request snapshot (ไม่ clone งวดเดิม)', async () => {
    const result = await service.approve(
      'pricedReq',
      { id: 'u1', role: 'OWNER', branchId: null },
      {},
    );
    const created = prisma.contract.create.mock.calls[0][0].data;
    expect(created.totalMonths).toBe(12);
    expect(created.monthlyPayment.toString()).toBe('1515.83');
    expect(created.financedAmount.toString()).toBe('10000');
    expect(created.interestTotal.toString()).toBe('6000');
    expect(created.downPayment.toString()).toBe('0');
    expect(result.mode).toBe('PRICED');
    // Snapshot branch must NOT run the legacy remaining-months clone
    expect(prisma.payment.count).not.toHaveBeenCalled();
    // Task 8 review fix 4 — snapshot-branch audit uses `totalMonths` key
    // (this is the FULL new plan's month count, not a remaining count)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_REQUEST_APPROVED',
        newValue: expect.objectContaining({ totalMonths: 12 }),
      }),
    );
    const auditValue = audit.log.mock.calls.find(
      (c: any[]) => c[0].action === 'EXCHANGE_REQUEST_APPROVED',
    )![0].newValue;
    expect(auditValue.remainingMonths).toBeUndefined();
  });

  it('B5: ตัด hold ของเว็บใน tx เดียวกับที่เครื่องออกจาก IN_STOCK', async () => {
    prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.approve('pricedReq', { id: 'u1', role: 'OWNER', branchId: null }, {});

    const call = prisma.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId.in).toContain('new-p');
    expect(call.where.status).toBe('ACTIVE');
    expect(call.data).toEqual({ status: 'PREEMPTED' });
  });

  it('PRICED snapshot branch: newProduct.installmentPrice null → BadRequest (defensive)', async () => {
    requests.pricedReq.newProduct = { id: 'new-p', installmentPrice: null };
    await expect(
      service.approve('pricedReq', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  // Task 8 review fix 2 — price-drift guard: live product price changed
  // between submit and approve → snapshot no longer reproducible → reject.
  it('PRICED snapshot branch: live price changed after submit → BadRequest ราคาเปลี่ยน', async () => {
    requests.pricedReq.newProduct = {
      id: 'new-p',
      installmentPrice: { toString: () => '12000' }, // was 10000 at submit
    };
    await expect(
      service.approve('pricedReq', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow('เปลี่ยนไประหว่างรออนุมัติ');
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  // Task 8 review fix 3 — old-contract status re-check at approve time
  // (approval can be days after submit; contract may have closed meanwhile).
  it('MEMO: old contract no longer ACTIVE (EARLY_PAYOFF) → BadRequest, no product swap', async () => {
    requests.memoReq.oldContract = {
      ...requests.memoReq.oldContract,
      status: 'EARLY_PAYOFF',
    };
    await expect(
      service.approve(
        'memoReq',
        { id: 'u1', role: 'OWNER', branchId: null },
        {
          memoAddendumSigned: true,
          memoMdmSwapped: true,
        },
      ),
    ).rejects.toThrow('เปลี่ยนเครื่องไม่ได้');
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled();
  });

  it('PRICED snapshot branch: old contract no longer ACTIVE (EARLY_PAYOFF) → BadRequest', async () => {
    requests.pricedReq.oldContract = {
      ...requests.pricedReq.oldContract,
      status: 'EARLY_PAYOFF',
    };
    await expect(
      service.approve('pricedReq', { id: 'u1', role: 'OWNER', branchId: null }, {}),
    ).rejects.toThrow('เปลี่ยนเครื่องไม่ได้');
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });
});

// ============================================================================
// finalizeAfterActivation() — SP2 v2 sign-then-activate flow
// Triggered by ContractWorkflowService.activate() when the contract being
// activated has exchangedFromContractId non-null. This is where the JE chain
// posts + the old-side status flips happen.
// ============================================================================
describe('ContractExchangeService.finalizeAfterActivation', () => {
  let service: ContractExchangeService;
  let tx: any;
  let templates: any;
  let audit: any;
  let companyResolver: any;

  // Make a typical exchange-contract object to pass through.
  const newContract = {
    id: 'new-c',
    productId: 'new-p',
    exchangedFromContractId: 'old-c',
    financedAmount: '10000',
    storeCommission: '1000',
    contractNumber: 'EXCH-20260801-0001',
    downPayment: '0',
    productCategory: 'PHONE_NEW' as const,
    productCostPrice: '9000',
  };

  beforeEach(async () => {
    tx = {
      contractExchangeRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          oldContractId: 'old-c',
          oldProductId: 'old-p',
          newContractId: 'new-c',
        }),
        update: jest.fn(),
      },
      contract: {
        update: jest.fn(),
        // Pre-flight guards (Task 9) read advanceBalance/creditBalance —
        // default zero so existing tests sail through the guards untouched.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          advanceBalance: { toString: () => '0' },
          creditBalance: { toString: () => '0' },
        }),
      },
      product: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'old-p', costPrice: '15000' }),
      },
      // Guards call glContractBalance twice (11-2103 dr, 21-1103 cr) BEFORE
      // computeOldOutstanding's own findMany call. Default [] on every call
      // keeps both guard balances at 0 and preserves the old 3rd-call shape
      // relied on by computeOldOutstanding tests below.
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
      badDebtProvision: { updateMany: jest.fn() },
    };
    templates = {
      t1a: { execute: jest.fn().mockResolvedValue({ id: 'je1-id', entryNumber: 'JV-A1' }) },
      t2: { execute: jest.fn().mockResolvedValue({ id: 'je2-id', entryNumber: 'JV-A2' }) },
      t3: { execute: jest.fn().mockResolvedValue({ id: 'je3-id', entryNumber: 'JV-A3' }) },
      t4: { execute: jest.fn().mockResolvedValue({ id: 'je4-id', entryNumber: 'JV-A4' }) },
      t5: { execute: jest.fn().mockResolvedValue(null) },
      shopInv: { execute: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };
    companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id') };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: templates.t3 },
        { provide: ShopExchangeReturnTemplate, useValue: templates.t4 },
        { provide: ExchangeEclReversalTemplate, useValue: templates.t5 },
        { provide: ShopInventoryTransferTemplate, useValue: templates.shopInv },
        {
          provide: ShopAccountResolver,
          useValue: {
            resolveProductAccounts: jest
              .fn()
              .mockReturnValue({
                inventoryAccountCode: 'S11-2001',
                cogsAccountCode: 'S50-1101',
                revenueAccountCode: 'S41-1101',
              }),
          },
        },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('runs A.1 → A.2 → A.3 → A.4 in order + flips old contract + old product + returns ids', async () => {
    const callOrder: string[] = [];
    templates.t1a.execute.mockImplementation(async () => {
      callOrder.push('t1a');
      return { id: 'je1-id' };
    });
    templates.t2.execute.mockImplementation(async () => {
      callOrder.push('t2');
      return { id: 'je2-id' };
    });
    templates.t3.execute.mockImplementation(async () => {
      callOrder.push('t3');
      return { id: 'je3-id' };
    });
    templates.t4.execute.mockImplementation(async () => {
      callOrder.push('t4');
      return { id: 'je4-id' };
    });

    const result = await service.finalizeAfterActivation(newContract, tx);

    expect(callOrder).toEqual(['t1a', 't2', 't3', 't4']);
    expect(templates.t1a.execute).toHaveBeenCalledWith('new-c', tx);

    // Old contract flip
    expect(tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-c' },
        data: expect.objectContaining({ status: 'EXCHANGED' }),
      }),
    );
    // Old product flip — REFURBISHED + ownedByCompanyId = SHOP
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-p' },
        data: expect.objectContaining({ status: 'REFURBISHED', ownedByCompanyId: 'shop-co-id' }),
      }),
    );

    // Return shape
    expect(result).toEqual({
      je1aId: 'je1-id',
      je2Id: 'je2-id',
      je3Id: 'je3-id',
      je4Id: 'je4-id',
      je5Id: null,
    });
  });

  // ==========================================================================
  // SHOP-leg wiring (F2) — review W2: assertions on the mock calls, not just
  // "does it throw" / "call order" (the pre-review test suite never actually
  // inspected what shopInv was CALLED WITH).
  //
  // 2026-08-03 (คำสั่งเจ้าของ, supersedes D5): the instant-settlement leg that
  // used to fire right after shopInv is GONE — S11-3001/S11-3002 now stay
  // outstanding and clear through the normal INTER-CO batch.
  // ==========================================================================
  describe('SHOP-leg wiring (F2 ShopInventoryTransfer — no instant settlement)', () => {
    it('shopInventoryTransfer receives salePrice = downPayment + financedAmount (reconstructed, never read from a sellingPrice field)', async () => {
      // ExchangeContractForFinalize has NO sellingPrice field at all — the
      // only way to prove the reconstruction (not some other source) is to
      // set a NONZERO downPayment and confirm salePrice tracks down+financed
      // exactly (a real exchange contract always has downPayment=0, but the
      // template's own math must hold regardless of what the caller passes).
      const contractWithDown = { ...newContract, downPayment: '2000', financedAmount: '10000' };
      await service.finalizeAfterActivation(contractWithDown, tx);

      const call = templates.shopInv.execute.mock.calls[0][0];
      expect(call.downAmount.toString()).toBe('2000');
      expect(call.financedAmount.toString()).toBe('10000');
      expect(call.salePrice.toString()).toBe('12000'); // 2000 + 10000, not e.g. a stray sellingPrice
    });

    it('SHOP receivable is booked ONCE and left outstanding — exactly one SHOP-side template call, no settlement leg (2026-08-03)', async () => {
      templates.shopInv.execute.mockResolvedValue({
        batchId: 'batch-xyz-123',
        cogsEntryNo: 'JE-COGS',
        cogsJournalEntryId: 'cogs-id',
        revenueEntryNo: 'JE-REV',
        revenueJournalEntryId: 'rev-id',
      });
      await service.finalizeAfterActivation(newContract, tx);

      // ShopInventoryTransfer fires exactly once (books S11-3001/S11-3002)…
      expect(templates.shopInv.execute).toHaveBeenCalledTimes(1);
      // …and nothing clears it in the same tx. A.3 is the only JE that fires
      // between shopInv and A.4, and it touches 11-2107/21-1106 only — its
      // input carries NO cash account and NO vendor amounts (proven by shape).
      const a3Input = templates.t3.execute.mock.calls[0][0];
      expect(Object.keys(a3Input).sort()).toEqual(['buyback', 'newContractId']);
    });

    it('newContract.productCostPrice == null → throws BEFORE shopInv fires, but AFTER A.1 (matches the implemented guard in contract-exchange.service.ts)', async () => {
      const contractNoCost = { ...newContract, productCostPrice: null };
      await expect(service.finalizeAfterActivation(contractNoCost, tx)).rejects.toThrow(
        InternalServerErrorException,
      );
      // A.1 already posted before this guard runs (step 4, guard is step 4b)
      expect(templates.t1a.execute).toHaveBeenCalled();
      // Guard throws — nothing SHOP-side, and nothing past it (A.2-A.4), ever fires
      expect(templates.shopInv.execute).not.toHaveBeenCalled();
      expect(templates.t2.execute).not.toHaveBeenCalled();
      expect(templates.t3.execute).not.toHaveBeenCalled();
      expect(templates.t4.execute).not.toHaveBeenCalled();
    });
  });

  it('throws InternalServerErrorException when no exchange request matches the new contract', async () => {
    tx.contractExchangeRequest.findFirst.mockResolvedValue(null);
    await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(templates.t1a.execute).not.toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when old product costPrice is null', async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue({ id: 'old-p', costPrice: null });
    await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
      InternalServerErrorException,
    );
    // A.4 must NOT have fired when cost is missing
    expect(templates.t4.execute).not.toHaveBeenCalled();
    // But A.1-A.3 already ran (no rollback at unit level — that's the caller's $tx job)
    expect(templates.t1a.execute).toHaveBeenCalled();
  });

  it('passes costPrice + requestId to A.4 template', async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue({ id: 'old-p', costPrice: '12345.67' });
    await service.finalizeAfterActivation(newContract, tx);
    const t4Call = templates.t4.execute.mock.calls[0][0];
    expect(t4Call.oldProductId).toBe('old-p');
    expect(t4Call.oldContractId).toBe('old-c');
    expect(t4Call.requestId).toBe('r1'); // C1b idempotency re-key
    expect(t4Call.cost.toString()).toBe('12345.67');
    // A.2 carries the same request-scoped key input
    expect(templates.t2.execute.mock.calls[0][0].requestId).toBe('r1');
  });

  it('stores je*Id refs on the exchange request', async () => {
    await service.finalizeAfterActivation(newContract, tx);
    expect(tx.contractExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          je1aId: 'je1-id',
          je2Id: 'je2-id',
          je3Id: 'je3-id',
          je4Id: 'je4-id',
        }),
      }),
    );
  });

  it('writes EXCHANGE_FINALIZED + EXCHANGE_DEVICE_RETURNED_TO_SHOP audit logs', async () => {
    await service.finalizeAfterActivation(newContract, tx);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_FINALIZED',
        entity: 'contract_exchange_request',
        entityId: 'r1',
        newValue: expect.objectContaining({
          oldContractId: 'old-c',
          newContractId: 'new-c',
          jeIds: expect.objectContaining({ je4Id: 'je4-id' }),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_DEVICE_RETURNED_TO_SHOP',
        entity: 'product',
        entityId: 'old-p',
        newValue: expect.objectContaining({
          exchangeRequestId: 'r1',
          oldContractId: 'old-c',
          jeId: 'je4-id',
          ownedByCompanyId: 'shop-co-id',
        }),
      }),
    );
  });

  // Issue #1086 item 3 — aggregate from journal_lines, not straight-line proration
  describe('computeOldOutstanding from journal_lines', () => {
    it('queries journalLine.findMany for the 4 relevant accounts', async () => {
      await service.finalizeAfterActivation(newContract, tx);
      expect(tx.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accountCode: { in: ['11-2101', '11-2105', '11-2106', '21-2102'] },
            deletedAt: null,
            journalEntry: expect.objectContaining({
              deletedAt: null,
              status: 'POSTED',
              OR: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('queries by BOTH referenceId AND metadata.contractId', async () => {
      await service.finalizeAfterActivation(newContract, tx);
      // Task 9: calls[0] and calls[1] are now the pre-flight guard's
      // glContractBalance queries (11-2103, 21-1103) — computeOldOutstanding
      // is the 3rd journalLine.findMany call.
      const call = tx.journalLine.findMany.mock.calls[2][0];
      const or = call.where.journalEntry.OR;
      expect(or).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ referenceId: 'old-c' }),
          expect.objectContaining({
            metadata: expect.objectContaining({ path: ['contractId'], equals: 'old-c' }),
          }),
        ]),
      );
    });

    it('aggregates Dr-Cr per account into expected outstanding figures', async () => {
      // Realistic 5-line ledger:
      //  11-2101: Dr 20000, Cr 3000  → net Dr 17000 (gross outstanding)
      //  11-2105: Dr 1400,  Cr 200   → net Dr 1200  (vat receivable outstanding)
      //  11-2106: Dr 1000,  Cr 5000  → net Cr 4000  (unearned interest remaining)
      //  21-2102: Dr 100,   Cr 1300  → net Cr 1200  (deferred VAT outstanding)
      // Task 9: the mock is a dumb stub that ignores the `where` filter, so it
      // must be sequenced per-call — calls 1-2 are the pre-flight guards
      // (must stay empty or they'd misread this fixture as a real 11-2103/
      // 21-1103 balance and reject before computeOldOutstanding ever runs);
      // call 3 is computeOldOutstanding, which gets the real fixture.
      tx.journalLine.findMany
        .mockResolvedValueOnce([]) // guard: 11-2103
        .mockResolvedValueOnce([]) // guard: 21-1103
        .mockResolvedValueOnce([
          {
            accountCode: '11-2101',
            debit: new Prisma.Decimal(20000),
            credit: new Prisma.Decimal(0),
          },
          {
            accountCode: '11-2101',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(3000),
          },
          {
            accountCode: '11-2105',
            debit: new Prisma.Decimal(1400),
            credit: new Prisma.Decimal(200),
          },
          {
            accountCode: '11-2106',
            debit: new Prisma.Decimal(1000),
            credit: new Prisma.Decimal(5000),
          },
          {
            accountCode: '21-2102',
            debit: new Prisma.Decimal(100),
            credit: new Prisma.Decimal(1300),
          },
        ]);
      await service.finalizeAfterActivation(newContract, tx);
      const t2Call = templates.t2.execute.mock.calls[0][0];
      expect(t2Call.oldGrossOutstanding.toString()).toBe('17000');
      expect(t2Call.oldVatReceivableOutstanding.toString()).toBe('1200');
      expect(t2Call.oldUnearnedInterestOutstanding.toString()).toBe('4000');
      expect(t2Call.oldDeferredVatOutstanding.toString()).toBe('1200');
    });

    it('returns all zeroes when contract has no journal lines yet', async () => {
      tx.journalLine.findMany.mockResolvedValue([]);
      await service.finalizeAfterActivation(newContract, tx);
      const t2Call = templates.t2.execute.mock.calls[0][0];
      expect(t2Call.oldGrossOutstanding.toString()).toBe('0');
    });
  });

  // ==========================================================================
  // Task 9 — finalize guards + buyback จาก request + A.5 wiring (Device Swap 2026-07)
  // ==========================================================================
  describe('finalizeAfterActivation guards + A.5 (Device Swap 2026-07)', () => {
    it('GL 11-2103 > 0 (งวดค้าง accrued) → BadRequest ก่อน post JE ใดๆ', async () => {
      // journalLine.findMany call #1 = the 11-2103 guard query — return a
      // real accrued-unpaid installment line (Dr 1515.83).
      tx.journalLine.findMany.mockResolvedValueOnce([
        {
          accountCode: '11-2103',
          debit: new Prisma.Decimal(1515.83),
          credit: new Prisma.Decimal(0),
        },
      ]);
      await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow('งวดค้าง');
      expect(templates.t1a.execute).not.toHaveBeenCalled();
      expect(templates.t2.execute).not.toHaveBeenCalled();
    });

    it('advanceBalance > 0 → BadRequest "เงินรับล่วงหน้า"', async () => {
      // Both GL guard balances stay 0 (default []); the advance-balance branch
      // of the second guard is what should fire here.
      tx.contract.findUniqueOrThrow.mockResolvedValueOnce({
        advanceBalance: { toString: () => '500' },
        creditBalance: { toString: () => '0' },
        rescheduleAdvanceBalance: { toString: () => '0' },
      });
      await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
        'เงินรับล่วงหน้า',
      );
      expect(templates.t1a.execute).not.toHaveBeenCalled();
    });

    it('rescheduleAdvanceBalance > 0 (พักงวดสุดท้าย, 2026-08-16) → BadRequest "เงินรับล่วงหน้า" — same treatment as advanceBalance/creditBalance', async () => {
      tx.contract.findUniqueOrThrow.mockResolvedValueOnce({
        advanceBalance: { toString: () => '0' },
        creditBalance: { toString: () => '0' },
        rescheduleAdvanceBalance: { toString: () => '354' },
      });
      await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
        'เงินรับล่วงหน้า',
      );
      expect(templates.t1a.execute).not.toHaveBeenCalled();
    });

    // 2026-08-03 (คำสั่งเจ้าของ): A.3 รับแค่ { newContractId, buyback } —
    // ไม่ส่ง depositAccountCode/vendor amounts อีกแล้ว (ไม่มีขาเงินสด และไม่แตะ
    // 21-1101/21-1102 ที่ต้องค้างไว้ให้รอบจ่าย INTER-CO)
    it('PRICED: buyback = request.buybackPrice (ไม่ใช่ vendorSum) + A.3 ไม่รับ depositAccountCode อีกต่อไป', async () => {
      tx.contractExchangeRequest.findFirst.mockResolvedValue({
        id: 'r1',
        oldContractId: 'old-c',
        oldProductId: 'old-p',
        newContractId: 'new-c',
        buybackPrice: '8000',
        // ค่านี้ยังอยู่บนแถว request (ประวัติ) แต่ต้องไม่ถูกส่งต่อเข้า A.3
        depositAccountCode: '11-1201',
      });
      await service.finalizeAfterActivation(newContract, tx);
      const t3Call = templates.t3.execute.mock.calls[0][0];
      expect(t3Call.buyback.toString()).toBe('8000');
      expect(t3Call.newContractId).toBe('new-c');
      expect(t3Call).not.toHaveProperty('depositAccountCode');
      expect(t3Call).not.toHaveProperty('newVendorYodjat');
      expect(t3Call).not.toHaveProperty('newVendorCommission');
    });

    it('A.5 ถูกเรียกหลัง A.4 + je5Id เก็บบน request + provision rows → REVERSED', async () => {
      const callOrder: string[] = [];
      templates.t4.execute.mockImplementation(async () => {
        callOrder.push('t4');
        return { id: 'je4-id' };
      });
      templates.t5.execute.mockImplementation(async () => {
        callOrder.push('t5');
        return { id: 'je5-id', entryNumber: 'JV-A5' };
      });

      const result = await service.finalizeAfterActivation(newContract, tx);

      expect(callOrder).toEqual(['t4', 't5']);
      // C1b: requestId flows into A.5 for the request-scoped idempotency key
      expect(templates.t5.execute).toHaveBeenCalledWith(
        { oldContractId: 'old-c', requestId: 'r1' },
        tx,
      );
      expect(tx.badDebtProvision.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'old-c', status: 'ACTIVE', deletedAt: null },
        data: { status: 'REVERSED' },
      });
      expect(result.je5Id).toBe('je5-id');
      expect(tx.contractExchangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eclReversalJeId: 'je5-id' }),
        }),
      );
    });

    it('A.5 returns null (no provision) → skip badDebtProvision.updateMany + je5Id null', async () => {
      const result = await service.finalizeAfterActivation(newContract, tx);
      expect(tx.badDebtProvision.updateMany).not.toHaveBeenCalled();
      expect(result.je5Id).toBeNull();
      expect(tx.contractExchangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eclReversalJeId: null }),
        }),
      );
    });

    it('legacy request (buybackPrice null) → fallback buyback = newFinanced + newCommission', async () => {
      // Default fixture request has no buybackPrice field → legacy fallback:
      // newFinanced (10000) + newCommission (1000) = 11000.
      await service.finalizeAfterActivation(newContract, tx);
      const je2Call = templates.t2.execute.mock.calls[0][0];
      expect(je2Call.buyback.toString()).toBe('11000');
    });
  });
});

describe('ContractExchangeService.reject', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    audit = { log: jest.fn() };
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      contractExchangeRequest: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', status: 'REJECTED' }),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: ExchangeEclReversalTemplate, useValue: {} },
        { provide: ShopInventoryTransferTemplate, useValue: { execute: jest.fn() } },
        { provide: ShopAccountResolver, useValue: { resolveProductAccounts: jest.fn() } },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('rejects with reason min length enforced', async () => {
    await expect(service.reject('r1', 'too short', 'u1')).rejects.toThrow(/อย่างน้อย 10/);
  });

  it('throws ConflictException when lock count = 0', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject('r1', 'reason with enough chars', 'u1')).rejects.toThrow(
      /อาจถูกตอบกลับ/,
    );
  });

  it('rejects + writes audit log', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    await service.reject('r1', 'เหตุผลปฏิเสธชัดเจน', 'u1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXCHANGE_REQUEST_REJECTED',
      }),
    );
  });
});

describe('ContractExchangeService.listRecent', () => {
  let service: ContractExchangeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contractExchangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeBuybackReceivable11_2107Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: ExchangeEclReversalTemplate, useValue: {} },
        { provide: ShopInventoryTransferTemplate, useValue: { execute: jest.fn() } },
        { provide: ShopAccountResolver, useValue: { resolveProductAccounts: jest.fn() } },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  const OWNER = { id: 'u1', role: 'OWNER', branchId: null };
  const BM_BR1 = { id: 'u2', role: 'BRANCH_MANAGER', branchId: 'br-1' };

  it('queries status=APPROVED, deletedAt=null, within a 90-day window, take 100', async () => {
    const before = Date.now();
    await service.listRecent(OWNER);
    const after = Date.now();

    expect(prisma.contractExchangeRequest.findMany).toHaveBeenCalledTimes(1);
    const call = prisma.contractExchangeRequest.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('APPROVED');
    expect(call.where.deletedAt).toBeNull();
    expect(call.take).toBe(100);
    expect(call.orderBy).toEqual({ updatedAt: 'desc' });
    // OWNER = cross-branch → no oldContract branch filter (I7)
    expect(call.where.oldContract).toBeUndefined();

    // updatedAt.gte should be ~90 days before now (within a small tolerance
    // for test execution time).
    const since: Date = call.where.updatedAt.gte;
    const expectedSince = before - 90 * 86_400_000;
    expect(since.getTime()).toBeGreaterThanOrEqual(expectedSince - 5000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 90 * 86_400_000 + 5000);
  });

  it('returns whatever prisma resolves', async () => {
    const rows = [{ id: 'r1', status: 'APPROVED' }];
    prisma.contractExchangeRequest.findMany.mockResolvedValue(rows);
    await expect(service.listRecent(OWNER)).resolves.toBe(rows);
  });

  // I7 (final review 2026-07-29) — BM only sees their own branch
  it('listRecent: BRANCH_MANAGER → where includes oldContract.branchId filter', async () => {
    await service.listRecent(BM_BR1);
    const call = prisma.contractExchangeRequest.findMany.mock.calls[0][0];
    expect(call.where.oldContract).toEqual({ branchId: 'br-1' });
  });

  it('listPending: BRANCH_MANAGER → where includes oldContract.branchId filter', async () => {
    await service.listPending(BM_BR1);
    const call = prisma.contractExchangeRequest.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('PENDING');
    expect(call.where.oldContract).toEqual({ branchId: 'br-1' });
  });

  it('listPending: OWNER (cross-branch) → no branch filter', async () => {
    await service.listPending(OWNER);
    const call = prisma.contractExchangeRequest.findMany.mock.calls[0][0];
    expect(call.where.oldContract).toBeUndefined();
  });
});

function makeOldContract(totalMonths: number, _paid: number) {
  return {
    id: 'old-c',
    customerId: 'cust',
    productId: 'old-p',
    branchId: 'br',
    salespersonId: 'sp',
    pdpaConsentId: null,
    planType: 'STORE_DIRECT',
    status: 'ACTIVE',
    totalMonths,
    monthlyPayment: { toString: () => '1416.66' } as any,
    financedAmount: { toString: () => '10000' } as any,
    storeCommission: { toString: () => '1000' } as any,
    interestRate: { toString: () => '16' } as any,
    interestTotal: { toString: () => '4000' } as any,
    vatAmount: { toString: () => '1190' } as any,
    sellingPrice: { toString: () => '28000' } as any,
    downPayment: { toString: () => '4000' } as any,
    creditBalance: { toString: () => '0' } as any,
  };
}

function todayBkk(): string {
  const parts = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}
