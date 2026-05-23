import { Test } from '@nestjs/testing';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SettingsService } from '../../settings/settings.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

/**
 * IMEI lookup endpoint — drives the /insurance/new wizard Step 1.
 * Returns Product + (latest) Sale + Customer + Contract + warranty status.
 *
 * Branch scoping (PDPA): SALES + BRANCH_MANAGER only see Sales from their own
 * branch. OWNER / FINANCE_MANAGER / ACCOUNTANT have cross-branch visibility.
 * Without branch scoping, scanning a foreign branch's IMEI would leak the
 * customer's name + phone — a PDPA violation.
 */
describe('RepairTicketsService.lookupByImei', () => {
  let service: RepairTicketsService;
  let prisma: any;

  const ownerUser = { id: 'u-owner', role: 'OWNER', branchId: 'br-A' };
  const salesAtA = { id: 'u-sales', role: 'SALES', branchId: 'br-A' };

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      sale: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: {} },
        { provide: ExpenseDocumentsService, useValue: {} },
        { provide: OtherIncomeService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: RepairTicketDocNumberService, useValue: {} },
      ],
    }).compile();
    service = mod.get(RepairTicketsService);
  });

  it('returns { found: false } when product not in DB', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    const result = await service.lookupByImei('UNKNOWN_IMEI', ownerUser);
    expect(result).toEqual({ found: false });
  });

  it('returns INSTALLMENT branch when Sale.saleType=INSTALLMENT, computes warranty', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-1', brand: 'iPhone', model: '15 Pro', storage: '256GB',
      imeiSerial: '359123456789012', category: 'PHONE', warrantyExpireDate: null,
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 'sale-1', saleType: 'INSTALLMENT',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0891234567' },
      contract: {
        id: 'ctr-1', contractNumber: 'BC-2026-04-0123', status: 'ACTIVE',
        deviceReceivedAt: new Date(Date.now() - 60 * 60 * 1000),
        shopWarrantyEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const result = await service.lookupByImei('359123456789012', ownerUser);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.sale?.saleType).toBe('INSTALLMENT');
    expect(result.contract?.contractNumber).toBe('BC-2026-04-0123');
    expect(result.customer?.name).toBe('สมชาย ใจดี');
    expect(result.product.id).toBe('prod-1');
    expect(result.warrantyStatus).toBe('IN_7DAY_DEFECT');
  });

  it('returns IN_MANUFACTURER when shop warranty expired but product warranty active', async () => {
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-m', brand: 'X', model: 'Y', storage: null,
      imeiSerial: 'MFR1', category: 'PHONE', warrantyExpireDate: future,
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 's', saleType: 'INSTALLMENT',
      customer: { id: 'c', name: 'A', phone: '0' },
      contract: { id: 'ctr', contractNumber: 'BC', status: 'ACTIVE',
        deviceReceivedAt: past, shopWarrantyEndDate: past },
    });

    const result = await service.lookupByImei('MFR1', ownerUser);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.warrantyStatus).toBe('IN_MANUFACTURER');
  });

  it('returns CASH branch with no contract', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-2', brand: 'Samsung', model: 'S24', storage: '128GB',
      imeiSerial: '359000111222333', category: 'PHONE', warrantyExpireDate: null,
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 'sale-2', saleType: 'CASH',
      customer: { id: 'cust-2', name: 'สมหญิง', phone: '0812345678' },
      contract: null,
    });

    const result = await service.lookupByImei('359000111222333', ownerUser);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.sale?.saleType).toBe('CASH');
    expect(result.contract).toBeNull();
    expect(result.warrantyStatus).toBe('OUT_OF_WARRANTY');
  });

  it('PDPA: SALES at branch A scanning device sold at branch B — product found, customer hidden', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-cross', brand: 'X', model: 'Y', storage: null,
      imeiSerial: 'CROSS', category: 'PHONE', warrantyExpireDate: null,
    });
    // findFirst with branchScope returns null because no Sale at br-A matches
    prisma.sale.findFirst.mockResolvedValue(null);

    const result = await service.lookupByImei('CROSS', salesAtA);

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.sale).toBeNull();
    expect(result.customer).toBeNull();
    expect(result.contract).toBeNull();

    const saleCall = prisma.sale.findFirst.mock.calls[0][0];
    expect(saleCall.where).toMatchObject({ productId: 'prod-cross', branchId: 'br-A' });
  });

  it('OWNER (cross-branch role) gets unrestricted Sale lookup — no branchId filter', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-x', brand: 'X', model: 'Y', storage: null,
      imeiSerial: 'X', category: 'PHONE', warrantyExpireDate: null,
    });
    prisma.sale.findFirst.mockResolvedValue(null);

    await service.lookupByImei('X', ownerUser);

    const saleCall = prisma.sale.findFirst.mock.calls[0][0];
    expect(saleCall.where).not.toHaveProperty('branchId');
  });

  it('orderBy createdAt desc — picks LATEST sale when product was resold', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p', brand: 'X', model: 'Y', storage: null,
      imeiSerial: 'RESOLD', category: 'PHONE', warrantyExpireDate: null,
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 'latest-sale', saleType: 'CASH',
      customer: { id: 'new-owner', name: 'NewOwner', phone: '0' },
      contract: null,
    });

    await service.lookupByImei('RESOLD', ownerUser);

    const saleCall = prisma.sale.findFirst.mock.calls[0][0];
    expect(saleCall.orderBy).toEqual({ createdAt: 'desc' });
  });
});
