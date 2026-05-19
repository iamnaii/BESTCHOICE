import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

// ─── Shared factory for transition tests ───────────────────────────────────

function buildTransitionModule() {
  const prisma: any = {
    $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
    supplier: { findUnique: jest.fn() },
    contract: { findUnique: jest.fn() },
    repairTicket: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    repairStatusLog: { create: jest.fn().mockResolvedValue({ id: 'sl-1' }) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const docNumber = { nextTicketNumber: jest.fn().mockResolvedValue('RT-20260519-0001') };
  return { prisma, audit, docNumber };
}

async function buildSvc(
  prisma: any,
  audit: any,
  docNumber: any,
  expenseDocs: any = {},
  otherIncome: any = {},
  settings: any = {},
) {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      RepairTicketsService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: ExpenseDocumentsService, useValue: expenseDocs },
      { provide: OtherIncomeService, useValue: otherIncome },
      { provide: SettingsService, useValue: settings },
      { provide: RepairTicketDocNumberService, useValue: docNumber },
    ],
  }).compile();
  return mod.get(RepairTicketsService);
}

// ─── RepairTicketsService.send ──────────────────────────────────────────────

describe('RepairTicketsService.send', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());
    svc = await buildSvc(prisma, audit, { nextTicketNumber: jest.fn() });
  });

  it('happy path OPEN → IN_PROGRESS', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' });

    await svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: 'OPEN', deletedAt: null },
      data: expect.objectContaining({ status: 'IN_PROGRESS', repairSupplierId: 'sup-1' }),
    });
    expect(prisma.repairStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_SENT' }),
    );
  });

  it('throws ConflictException when ticket not in OPEN', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws BadRequestException when supplier.isRepairCenter = false', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: false });

    await expect(svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException when supplier does not exist', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);

    await expect(svc.send('t-1', { repairSupplierId: 'sup-missing' } as any, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('persists optional externalClaimNo and estimatedCost in update data', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' });

    await svc.send(
      't-1',
      { repairSupplierId: 'sup-1', externalClaimNo: 'CLM-001', estimatedCost: 500 } as any,
      OWNER,
    );

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalClaimNo: 'CLM-001',
          estimatedCost: new Prisma.Decimal(500),
        }),
      }),
    );
  });
});

// ─── RepairTicketsService.markRepaired ─────────────────────────────────────

describe('RepairTicketsService.markRepaired', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());
    svc = await buildSvc(prisma, audit, { nextTicketNumber: jest.fn() });
  });

  it('happy path IN_PROGRESS → READY_FOR_PICKUP', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'READY_FOR_PICKUP' });

    await svc.markRepaired(
      't-1',
      { actualCost: 1500, payer: 'SHOP' } as any,
      OWNER,
    );

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: 'IN_PROGRESS', deletedAt: null },
      data: expect.objectContaining({ status: 'READY_FOR_PICKUP' }),
    });
    expect(prisma.repairStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'IN_PROGRESS', toStatus: 'READY_FOR_PICKUP' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_MARKED_REPAIRED' }),
    );
  });

  it('throws ConflictException when not in IN_PROGRESS', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      svc.markRepaired('t-1', { actualCost: 1500, payer: 'SHOP' } as any, OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores actualCost as Prisma.Decimal, not raw Number', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1' });

    await svc.markRepaired('t-1', { actualCost: 999.99, payer: 'CUSTOMER' } as any, OWNER);

    const callArgs = prisma.repairTicket.updateMany.mock.calls[0][0];
    expect(callArgs.data.actualCost).toBeInstanceOf(Prisma.Decimal);
    expect(callArgs.data.actualCost.toString()).toBe('999.99');
  });

  it('accepts SUPPLIER_CLAIM payer override', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1' });

    await svc.markRepaired(
      't-1',
      { actualCost: 0, payer: 'SUPPLIER_CLAIM' } as any,
      OWNER,
    );

    const callArgs = prisma.repairTicket.updateMany.mock.calls[0][0];
    expect(callArgs.data.payer).toBe('SUPPLIER_CLAIM');
  });
});

// ─── RepairTicketsService.sendBack ─────────────────────────────────────────

describe('RepairTicketsService.sendBack', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());
    svc = await buildSvc(prisma, audit, { nextTicketNumber: jest.fn() });
  });

  it('happy path READY_FOR_PICKUP → IN_PROGRESS', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' });

    await svc.sendBack('t-1', { note: 'ซ่อมยังไม่สำเร็จ' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: 'READY_FOR_PICKUP', deletedAt: null },
      data: expect.objectContaining({ status: 'IN_PROGRESS' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_SENT_BACK' }),
    );
  });

  it('clears repairedAt when sending back', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1' });

    await svc.sendBack('t-1', { note: 'QC fail' } as any, OWNER);

    const callArgs = prisma.repairTicket.updateMany.mock.calls[0][0];
    expect(callArgs.data.repairedAt).toBeNull();
  });

  it('status log includes the dto.note', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1' });

    const note = 'เสียงลำโพงยังดัง';
    await svc.sendBack('t-1', { note } as any, OWNER);

    expect(prisma.repairStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note }),
    });
  });
});

// ─── RepairTicketsService.cancel ───────────────────────────────────────────

describe('RepairTicketsService.cancel', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());
    svc = await buildSvc(prisma, audit, { nextTicketNumber: jest.fn() });
  });

  it('happy path OPEN → CANCELLED', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'OPEN', deletedAt: null });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique
      .mockResolvedValueOnce({ id: 't-1', status: 'OPEN', deletedAt: null })
      .mockResolvedValueOnce({ id: 't-1', status: 'CANCELLED' });

    await svc.cancel('t-1', { note: 'ลูกค้ายกเลิก' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 't-1',
          status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] },
        }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_CANCELLED' }),
    );
  });

  it('happy path IN_PROGRESS → CANCELLED', async () => {
    prisma.repairTicket.findUnique
      .mockResolvedValueOnce({ id: 't-1', status: 'IN_PROGRESS', deletedAt: null })
      .mockResolvedValueOnce({ id: 't-1', status: 'CANCELLED' });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });

    await svc.cancel('t-1', { note: 'ลูกค้าเปลี่ยนใจ' } as any, OWNER);

    const statusLogCall = prisma.repairStatusLog.create.mock.calls[0][0];
    expect(statusLogCall.data.fromStatus).toBe('IN_PROGRESS');
    expect(statusLogCall.data.toStatus).toBe('CANCELLED');
  });

  it('throws ConflictException when already in terminal state', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({
      id: 't-1',
      status: 'CANCELLED',
      deletedAt: null,
    });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      svc.cancel('t-1', { note: 'ลูกค้ายกเลิกอีก' } as any, OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ─── RepairTicketsService.replace ──────────────────────────────────────────

describe('RepairTicketsService.replace', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());
    svc = await buildSvc(prisma, audit, { nextTicketNumber: jest.fn() });
  });

  it('happy path: contract.customerId matches → calls updateMany + status log + audit', async () => {
    prisma.repairTicket.findUnique
      .mockResolvedValueOnce({ id: 't-1', customerId: 'cust-1', status: 'OPEN', deletedAt: null })
      .mockResolvedValueOnce({ id: 't-1', status: 'REPLACED' }); // final findUnique return
    prisma.contract.findUnique.mockResolvedValue({
      id: 'contract-new',
      customerId: 'cust-1',
      deletedAt: null,
    });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });

    await svc.replace('t-1', { replacementContractId: 'contract-new' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REPLACED', replacementContractId: 'contract-new' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_REPLACED' }),
    );
  });

  it('throws ForbiddenException when contract.customerId mismatches ticket.customerId', async () => {
    prisma.repairTicket.findUnique.mockResolvedValueOnce({
      id: 't-1',
      customerId: 'cust-1',
      deletedAt: null,
    });
    prisma.contract.findUnique.mockResolvedValue({
      id: 'contract-other',
      customerId: 'cust-OTHER',
      deletedAt: null,
    });

    await expect(
      svc.replace('t-1', { replacementContractId: 'contract-other' } as any, OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─── RepairTicketsService.returnToCustomer ─────────────────────────────────

describe('RepairTicketsService.returnToCustomer', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;
  let expenseDocs: any;
  let otherIncome: any;

  /** Helper: build a ticket stub with sensible defaults. */
  function stubTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 't-1',
      branchId: 'br-1',
      customerId: 'c-1',
      payer: 'SHOP',
      repairSupplierId: 'sup-1',
      actualCost: new Prisma.Decimal(2500),
      defectDescription: 'จอเสีย',
      customer: { id: 'c-1', name: 'นาย ก' },
      product: null,
      contract: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    ({ prisma, audit } = buildTransitionModule());

    // Add repairTicket.update + systemConfig mock to the prisma stub
    prisma.repairTicket.update = jest.fn().mockResolvedValue({ id: 't-1' });
    prisma.systemConfig = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.supplier = { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', name: 'ซัพพลายเออร์ A' }) };

    expenseDocs = {
      createDraftForRepair: jest.fn().mockResolvedValue({ id: 'ed-1' }),
    };
    otherIncome = {
      createDraftForRepair: jest.fn().mockResolvedValue({ id: 'oi-1' }),
    };

    svc = await buildSvc(
      prisma,
      audit,
      { nextTicketNumber: jest.fn() },
      expenseDocs,
      otherIncome,
      {},
    );
  });

  // Test 1: payer=SHOP → creates ExpenseDocument draft + links FK
  it('payer=SHOP → creates ExpenseDocument draft and links expenseDocumentId', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue(stubTicket({ payer: 'SHOP' }));

    await svc.returnToCustomer('t-1', {} as any, OWNER);

    expect(expenseDocs.createDraftForRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorName: 'ซัพพลายเออร์ A',
        amount: new Prisma.Decimal(2500),
      }),
      expect.anything(), // tx
    );
    expect(prisma.repairTicket.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { expenseDocumentId: 'ed-1', otherIncomeId: null },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_RETURNED' }),
    );
  });

  // Test 2: payer=CUSTOMER → creates OtherIncome draft + links FK
  it('payer=CUSTOMER → creates OtherIncome draft and links otherIncomeId', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue(
      stubTicket({
        id: 't-2',
        payer: 'CUSTOMER',
        repairSupplierId: null,
      }),
    );

    await svc.returnToCustomer('t-2', {} as any, OWNER);

    expect(otherIncome.createDraftForRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        counterpartyName: 'นาย ก',
        customerId: 'c-1',
        amount: new Prisma.Decimal(2500),
      }),
      expect.anything(), // tx
    );
    expect(prisma.repairTicket.update).toHaveBeenCalledWith({
      where: { id: 't-2' },
      data: { expenseDocumentId: null, otherIncomeId: 'oi-1' },
    });
  });

  // Test 3: payer=SUPPLIER_CLAIM → no doc created, FKs remain null, no update call
  it('payer=SUPPLIER_CLAIM → no doc created and repairTicket.update not called', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue(
      stubTicket({ payer: 'SUPPLIER_CLAIM', actualCost: new Prisma.Decimal(0) }),
    );

    await svc.returnToCustomer('t-3', {} as any, OWNER);

    expect(expenseDocs.createDraftForRepair).not.toHaveBeenCalled();
    expect(otherIncome.createDraftForRepair).not.toHaveBeenCalled();
    expect(prisma.repairTicket.update).not.toHaveBeenCalled();
    // Status log + audit should still be written
    expect(prisma.repairStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'READY_FOR_PICKUP', toStatus: 'CLOSED' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPAIR_TICKET_RETURNED' }),
    );
  });

  // Test 4: idempotency — re-call throws ConflictException via CAS
  it('re-call throws ConflictException when CAS returns count=0', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.returnToCustomer('t-1', {} as any, OWNER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // Test 5: tx rollback — expense doc creation throws → repairTicket.update never called
  it('rolls back: when createDraftForRepair throws, repairTicket.update is not called', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue(stubTicket({ payer: 'SHOP' }));
    expenseDocs.createDraftForRepair = jest
      .fn()
      .mockRejectedValue(new Error('vendor not found'));

    await expect(svc.returnToCustomer('t-1', {} as any, OWNER)).rejects.toThrow('vendor not found');
    expect(prisma.repairTicket.update).not.toHaveBeenCalled();
  });
});
