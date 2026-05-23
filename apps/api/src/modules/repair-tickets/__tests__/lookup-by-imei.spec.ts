import { Test } from '@nestjs/testing';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SettingsService } from '../../settings/settings.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

describe('RepairTicketsService.lookupByImei', () => {
  let service: RepairTicketsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      sale: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
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
    const result = await service.lookupByImei('UNKNOWN_IMEI');
    expect(result).toEqual({ found: false });
  });

  it('returns INSTALLMENT branch when Sale.saleType=INSTALLMENT', async () => {
    const productMock = {
      id: 'prod-1', brand: 'iPhone', model: '15 Pro', storage: '256GB',
      imeiSerial: '359123456789012',
    };
    const saleMock = {
      id: 'sale-1', saleType: 'INSTALLMENT', customerId: 'cust-1',
      contractId: 'ctr-1',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0891234567' },
      contract: {
        id: 'ctr-1', contractNumber: 'BC-2026-04-0123', status: 'ACTIVE',
        deviceReceivedAt: new Date('2026-05-20'),
        shopWarrantyEndDate: new Date('2026-05-27'),
      },
    };
    prisma.product.findFirst.mockResolvedValue(productMock);
    prisma.sale.findFirst.mockResolvedValue(saleMock);

    const result = await service.lookupByImei('359123456789012');

    expect(result.found).toBe(true);
    expect(result.sale?.saleType).toBe('INSTALLMENT');
    expect(result.contract?.contractNumber).toBe('BC-2026-04-0123');
    expect(result.customer?.name).toBe('สมชาย ใจดี');
    expect(result.product?.id).toBe('prod-1');
  });

  it('returns CASH branch with no contract', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-2', brand: 'Samsung', model: 'S24', storage: '128GB',
      imeiSerial: '359000111222333',
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 'sale-2', saleType: 'CASH', customerId: 'cust-2', contractId: null,
      customer: { id: 'cust-2', name: 'สมหญิง', phone: '0812345678' },
      contract: null,
    });

    const result = await service.lookupByImei('359000111222333');

    expect(result.sale?.saleType).toBe('CASH');
    expect(result.contract).toBeNull();
  });

  it('treats missing Sale record as EXTERNAL_FINANCE (block exchange path)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-3', imeiSerial: 'X' });
    prisma.sale.findFirst.mockResolvedValue(null);

    const result = await service.lookupByImei('X');

    expect(result.found).toBe(true);
    expect(result.sale).toBeNull();
  });
});
