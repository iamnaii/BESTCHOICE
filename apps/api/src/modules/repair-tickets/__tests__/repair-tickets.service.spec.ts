import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SettingsService } from '../../settings/settings.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

const OWNER: { id: string; role: string; branchId: string | null } = {
  id: 'u-owner',
  role: 'OWNER',
  branchId: null,
};

const BASE_DTO = {
  customerId: 'c-1',
  defectDescription: 'หน้าจอแตก',
  branchId: 'b-1',
};

describe('RepairTicketsService.create', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;
  let docNumber: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contract: { findUnique: jest.fn().mockResolvedValue(null) },
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      repairTicket: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 't-1',
          ...data,
        })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      repairStatusLog: { create: jest.fn().mockResolvedValue({ id: 'sl-1' }) },
    };

    audit = { log: jest.fn().mockResolvedValue(undefined) };
    docNumber = {
      nextTicketNumber: jest.fn().mockResolvedValue('RT-20260519-0001'),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExpenseDocumentsService, useValue: {} },
        { provide: OtherIncomeService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: RepairTicketDocNumberService, useValue: docNumber },
      ],
    }).compile();

    svc = mod.get(RepairTicketsService);
  });

  // Test 1: WALK_IN — no contract, no product
  it('sets warrantyStatus=WALK_IN and payer=CUSTOMER when no contract/product linked', async () => {
    const ticket = await svc.create({ ...BASE_DTO }, OWNER);

    expect(ticket.warrantyStatus).toBe('WALK_IN');
    expect(ticket.payer).toBe('CUSTOMER');
  });

  // Test 2: IN_7DAY_DEFECT — contract.deviceReceivedAt 3 days ago
  it('sets warrantyStatus=IN_7DAY_DEFECT when device received 3 days ago', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    prisma.contract.findUnique.mockResolvedValue({
      id: 'contract-1',
      deviceReceivedAt: threeDaysAgo,
      shopWarrantyEndDate: null,
    });

    const ticket = await svc.create({ ...BASE_DTO, contractId: 'contract-1' }, OWNER);

    expect(ticket.warrantyStatus).toBe('IN_7DAY_DEFECT');
    // Default payer for in-warranty = SHOP
    expect(ticket.payer).toBe('SHOP');
  });

  // Test 3: IN_SHOP_WARRANTY — contract 20 days old, shop warranty still active
  it('sets warrantyStatus=IN_SHOP_WARRANTY when shop warranty end date is in the future', async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);
    prisma.contract.findUnique.mockResolvedValue({
      id: 'contract-2',
      deviceReceivedAt: twentyDaysAgo,
      shopWarrantyEndDate: thirtyDaysFromNow,
    });

    const ticket = await svc.create({ ...BASE_DTO, contractId: 'contract-2' }, OWNER);

    expect(ticket.warrantyStatus).toBe('IN_SHOP_WARRANTY');
    expect(ticket.payer).toBe('SHOP');
  });

  // Test 4: IN_MANUFACTURER — only product with active manufacturer warranty
  it('sets warrantyStatus=IN_MANUFACTURER when product has active manufacturer warranty', async () => {
    const sixMonthsFromNow = new Date(Date.now() + 180 * 86_400_000);
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      warrantyExpireDate: sixMonthsFromNow,
    });

    const ticket = await svc.create({ ...BASE_DTO, productId: 'product-1' }, OWNER);

    expect(ticket.warrantyStatus).toBe('IN_MANUFACTURER');
    expect(ticket.payer).toBe('SHOP');
  });

  // Test 5: OUT_OF_WARRANTY — all warranties expired
  it('sets warrantyStatus=OUT_OF_WARRANTY and payer=CUSTOMER when all warranties expired', async () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
    const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);
    prisma.contract.findUnique.mockResolvedValue({
      id: 'contract-3',
      deviceReceivedAt: sixtyDaysAgo,
      shopWarrantyEndDate: oneYearAgo,
    });
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-2',
      warrantyExpireDate: oneYearAgo,
    });

    const ticket = await svc.create(
      { ...BASE_DTO, contractId: 'contract-3', productId: 'product-2' },
      OWNER,
    );

    expect(ticket.warrantyStatus).toBe('OUT_OF_WARRANTY');
    expect(ticket.payer).toBe('CUSTOMER');
  });

  // Test 6: Stale contractId — throws NotFoundException
  it('throws NotFoundException when contractId is provided but contract not found', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);

    await expect(
      svc.create({ ...BASE_DTO, contractId: 'non-existent-contract' }, OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Test 7: Ticket number format matches RT-YYYYMMDD-NNNN
  it('generates ticketNumber in RT-YYYYMMDD-NNNN format', async () => {
    const realDate = new Date();
    const yyyymmdd = realDate
      .toLocaleString('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .replace(/-/g, '');

    docNumber.nextTicketNumber.mockResolvedValue(`RT-${yyyymmdd}-0001`);

    const ticket = await svc.create({ ...BASE_DTO }, OWNER);

    expect(ticket.ticketNumber).toMatch(/^RT-\d{8}-\d{4}$/);
  });

  // Test 8: AuditLog written with correct action
  it('calls audit.log with action REPAIR_TICKET_CREATED', async () => {
    await svc.create({ ...BASE_DTO }, OWNER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER.id,
        action: 'REPAIR_TICKET_CREATED',
        entity: 'repair_ticket',
      }),
    );
  });
});
