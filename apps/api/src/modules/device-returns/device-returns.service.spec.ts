import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import { RepossessionsService } from '../repossessions/repossessions.service';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';
import {
  DeviceReturnsService,
  deriveReturnKind,
  allowedReasonsFor,
} from './device-returns.service';

const decimal = (v: number | string) => new Prisma.Decimal(v);
const OWNER = { id: 'owner-1', role: 'OWNER', branchId: null };
const BM_A = { id: 'bm-a', role: 'BRANCH_MANAGER', branchId: 'branch-a' };
const SALES_A = { id: 'sales-a', role: 'SALES', branchId: 'branch-a' };
const FM = { id: 'fm-1', role: 'FINANCE_MANAGER', branchId: null };

function makeContract(over: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    contractNumber: 'BCP2609-00042',
    status: 'ACTIVE',
    deletedAt: null,
    branchId: 'branch-b',
    customerId: 'cust-1',
    productId: 'product-1',
    totalMonths: 12,
    product: {
      id: 'product-1',
      brand: 'Apple',
      model: 'iPhone 14',
      storage: '128GB',
      imeiSerial: 'IMEI-1',
      status: 'SOLD_INSTALLMENT',
    },
    customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
    branch: { id: 'branch-b', name: 'บางกะปิ' },
    payments: [
      {
        id: 'pay-1',
        installmentNo: 1,
        status: 'PAID',
        amountDue: decimal(1000),
        amountPaid: decimal(1000),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
      {
        id: 'pay-2',
        installmentNo: 2,
        status: 'OVERDUE',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(100),
        lateFeeWaived: false,
      },
      {
        id: 'pay-3',
        installmentNo: 3,
        status: 'PENDING',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
    ],
    ...over,
  };
}

function makeReturnRow(over: Record<string, unknown> = {}) {
  return {
    id: 'dr-1',
    docNumber: 'DR-20260920-0001',
    status: 'PENDING_CONFIRM',
    returnKind: 'VOLUNTARY',
    returnReason: 'UNAFFORDABLE',
    deviceReceivedAt: new Date('2026-09-20T03:00:00.000Z'),
    conditionGrade: 'B',
    appraisalPrice: decimal(6000),
    tableBasePrice: null,
    repairCost: decimal(0),
    notes: null,
    previousContractStatus: 'ACTIVE',
    contractId: 'contract-1',
    productId: 'product-1',
    customerId: 'cust-1',
    receivingBranchId: 'branch-a',
    receivedById: 'sales-a',
    confirmedById: null,
    confirmedAt: null,
    repossessionId: null,
    rejectedById: null,
    rejectedAt: null,
    rejectReason: null,
    canceledById: null,
    canceledAt: null,
    lineNotifyStatus: null,
    lineNotifiedAt: null,
    lineNotificationId: null,
    createdAt: new Date('2026-09-20T03:05:00.000Z'),
    updatedAt: new Date('2026-09-20T03:05:00.000Z'),
    deletedAt: null,
    receivingBranch: { id: 'branch-a', name: 'ลาดพร้าว' },
    receivedBy: { id: 'sales-a', name: 'พนักงาน ก' },
    contract: {
      id: 'contract-1',
      contractNumber: 'BCP2609-00042',
      status: 'TERMINATED',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
      product: { id: 'product-1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' },
    },
    ...over,
  };
}

describe('DeviceReturnsService', () => {
  let service: DeviceReturnsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let numberService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notify: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tags: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repossessions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journey: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cnDelivery: any;

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deviceReturn: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repossession: { findFirst: jest.fn().mockResolvedValue(null) },
      contractExchangeRequest: { count: jest.fn().mockResolvedValue(0) },
      contractCancellation: { count: jest.fn().mockResolvedValue(0) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-x', name: 'สาขา X' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      tradeInValuation: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };
    numberService = { next: jest.fn().mockResolvedValue('DR-20260920-0001') };
    notify = { notify: jest.fn().mockResolvedValue(undefined) };
    tags = { recomputeForCustomer: jest.fn().mockResolvedValue({ added: [], removed: [] }) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    cnDelivery = { deliver: jest.fn().mockResolvedValue({ delivered: true }) };
    repossessions = {
      assertRepossessionPeriodsOpen: jest
        .fn()
        .mockResolvedValue({ financeCompanyId: 'company-finance', shopCompanyId: 'company-shop' }),
      createInTx: jest.fn().mockResolvedValue({
        repossession: { id: 'repo-1' },
        outstandingBalance: decimal(2100),
        totalPaid: decimal(1000),
        creditNote: { outcome: 'ISSUED', receiptId: 'r1' },
      }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceReturnsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RepossessionsService, useValue: repossessions },
        { provide: DeviceReturnNumberService, useValue: numberService },
        { provide: DeviceReturnNotifyService, useValue: notify },
        { provide: CustomerTagsService, useValue: tags },
        { provide: JourneyEntryWriter, useValue: journey },
        { provide: AuditService, useValue: audit },
        { provide: CreditNoteDeliveryService, useValue: cnDelivery },
      ],
    }).compile();
    service = mod.get(DeviceReturnsService);
  });

  describe('deriveReturnKind / allowedReasonsFor', () => {
    it('TERMINATED → REPOSSESSION (AFTER_TERMINATION เท่านั้น); ACTIVE/OVERDUE/DEFAULT → VOLUNTARY (3 เหตุผล); อื่น ๆ → null', () => {
      expect(deriveReturnKind('TERMINATED')).toBe('REPOSSESSION');
      expect(deriveReturnKind('ACTIVE')).toBe('VOLUNTARY');
      expect(deriveReturnKind('OVERDUE')).toBe('VOLUNTARY');
      expect(deriveReturnKind('DEFAULT')).toBe('VOLUNTARY');
      expect(deriveReturnKind('COMPLETED')).toBeNull();
      expect(deriveReturnKind('CLOSED_BAD_DEBT')).toBeNull();
      expect(allowedReasonsFor('REPOSSESSION')).toEqual(['AFTER_TERMINATION']);
      expect(allowedReasonsFor('VOLUNTARY')).toEqual(['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER']);
      expect(allowedReasonsFor(null)).toEqual([]);
    });
  });

  describe('preview', () => {
    it('ACTIVE + เกรด → VOLUNTARY, canCreate, ราคาตาราง, deviationPct, ยอดค้าง 2dp — ไม่จำกัดสาขา (D7: BM สาขาอื่นก็ดูได้)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.tradeInValuation.findFirst.mockResolvedValue({
        basePrice: decimal(8000),
        note: 'จอเดิม',
      });

      const result = await service.preview(
        { contractId: 'contract-1', conditionGrade: 'B', appraisalPrice: 6000 },
        BM_A as never,
      );

      expect(result.contract).toEqual({
        id: 'contract-1',
        contractNumber: 'BCP2609-00042',
        status: 'ACTIVE',
        customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
        product: {
          id: 'product-1',
          brand: 'Apple',
          model: 'iPhone 14',
          storage: '128GB',
          imeiSerial: 'IMEI-1',
        },
        branch: { id: 'branch-b', name: 'บางกะปิ' },
      });
      expect(result.returnKind).toBe('VOLUNTARY');
      expect(result.eligibility).toEqual({ canCreate: true, reason: null });
      expect(result.allowedReasons).toEqual(['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER']);
      expect(result.valuation).toEqual({
        grade: 'B',
        found: true,
        suggestedPrice: 8000,
        note: 'จอเดิม',
      });
      expect(result.deviationPct).toBe(25); // |6000 − 8000| / 8000
      expect(result.outstandingBalance).toBe('2100.00');
    });

    it('TERMINATED → REPOSSESSION + เหตุผลเดียว; ไม่มีเกรด → valuation null, deviationPct null', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
      const result = await service.preview({ contractId: 'contract-1' }, OWNER as never);
      expect(result.returnKind).toBe('REPOSSESSION');
      expect(result.allowedReasons).toEqual(['AFTER_TERMINATION']);
      expect(result.valuation).toBeNull();
      expect(result.deviationPct).toBeNull();
    });

    it('สถานะไม่เข้าเกณฑ์ (COMPLETED) → canCreate=false พร้อมเหตุผล, kind null, allowedReasons []', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'COMPLETED' }));
      const result = await service.preview({ contractId: 'contract-1' }, OWNER as never);
      expect(result.returnKind).toBeNull();
      expect(result.eligibility).toEqual({
        canCreate: false,
        reason: 'สัญญานี้ไม่อยู่ในสถานะที่รับเครื่องคืนได้',
      });
      expect(result.allowedReasons).toEqual([]);
    });

    it('ยอดค้าง 0 → ZERO_OUTSTANDING_MSG; เครื่องเคยยึด → RE_REPOSSESSION_MSG; มีใบ PENDING → ข้อความใบซ้ำ; คำขอเปลี่ยนเครื่อง PENDING → ข้อความคำขอค้าง', async () => {
      const paid = makeContract().payments.map((p) => ({
        ...p,
        status: 'PAID',
        amountPaid: p.amountDue,
      }));
      prisma.contract.findUnique.mockResolvedValue(makeContract({ payments: paid }));
      expect(
        (await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason,
      ).toMatch(/ไม่มียอดค้างชำระ/);

      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
      expect(
        (await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason,
      ).toMatch(/เคยถูกยึดคืนมาแล้ว/);

      prisma.deviceReturn.findFirst.mockResolvedValueOnce({
        id: 'dr-open',
        docNumber: 'DR-20260919-0003',
      });
      expect(
        (await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason,
      ).toBe('สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว');

      prisma.contractExchangeRequest.count.mockResolvedValueOnce(1);
      expect(
        (await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason,
      ).toMatch(/คำขอเปลี่ยนเครื่อง/);
    });

    it('ไม่พบสัญญา → NotFoundException', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(service.preview({ contractId: 'nope' }, OWNER as never)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('lookup', () => {
    it('q สั้นกว่า 3 ตัว → [] โดยไม่ query', async () => {
      expect(await service.lookup('ab', SALES_A as never)).toEqual([]);
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('ค้นเลขสัญญา/เบอร์/IMEI (contains) ≤ 20 แถว ทุกสาขา (D7) — แถวไม่มีเบอร์ลูกค้า', async () => {
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          contractNumber: 'BCP2609-00042',
          status: 'ACTIVE',
          customer: { id: 'cu1', name: 'สมชาย', phone: '0812345678' },
          product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' },
          branch: { id: 'b1', name: 'ลาดพร้าว' },
        },
      ]);
      const rows = await service.lookup('0042', SALES_A as never);
      expect(rows).toEqual([
        {
          id: 'c1',
          contractNumber: 'BCP2609-00042',
          status: 'ACTIVE',
          customer: { id: 'cu1', name: 'สมชาย' },
          product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' },
          branch: { id: 'b1', name: 'ลาดพร้าว' },
        },
      ]);
      const args = prisma.contract.findMany.mock.calls[0][0];
      expect(args.take).toBe(20);
      expect(args.where).toEqual({
        deletedAt: null,
        OR: [
          { contractNumber: { contains: '0042', mode: 'insensitive' } },
          { customer: { phone: { contains: '0042' } } },
          { product: { imeiSerial: { contains: '0042', mode: 'insensitive' } } },
        ],
      });
      expect(JSON.stringify(rows)).not.toContain('0812345678');
    });
  });

  describe('create', () => {
    const dto = () => ({
      contractId: 'contract-1',
      deviceReceivedAt: new Date(Date.now() - 3600_000).toISOString(),
      conditionGrade: 'B' as const,
      appraisalPrice: 6000,
      returnReason: 'UNAFFORDABLE' as const,
    });
    const arm = (contract = makeContract()) => {
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.deviceReturn.create.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ lineNotifyStatus: 'SENT' }),
      );
    };

    it('BM/SALES ไม่มี branchId → 403 fail-closed ก่อนแตะ DB', async () => {
      await expect(
        service.create(dto(), { id: 'u', role: 'SALES', branchId: null } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('OWNER ต้องระบุ receivingBranchId (400) และสาขาต้องมีอยู่ (404)', async () => {
      await expect(service.create(dto(), OWNER as never)).rejects.toThrow(
        'กรุณาระบุสาขาที่รับเครื่อง',
      );
      prisma.branch.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.create({ ...dto(), receivingBranchId: 'branch-x' }, OWNER as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('วันรับเครื่องเป็นอนาคต → 400', async () => {
      const future = new Date(Date.now() + 48 * 3600_000).toISOString();
      await expect(
        service.create({ ...dto(), deviceReceivedAt: future }, SALES_A as never),
      ).rejects.toThrow('วันที่รับเครื่องต้องไม่เป็นวันในอนาคต');
    });

    it('VOLUNTARY: ไม่ส่งเหตุผล → 400; เหตุผล AFTER_TERMINATION → 400; OTHER ไม่มีรายละเอียด → 400', async () => {
      arm();
      await expect(
        service.create({ ...dto(), returnReason: undefined }, SALES_A as never),
      ).rejects.toThrow('กรุณาเลือกเหตุผลคืนเครื่อง');
      await expect(
        service.create({ ...dto(), returnReason: 'AFTER_TERMINATION' }, SALES_A as never),
      ).rejects.toThrow(/เหตุผลคืนเครื่องไม่ตรงกับประเภท/);
      await expect(
        service.create({ ...dto(), returnReason: 'OTHER', notes: '  ' }, SALES_A as never),
      ).rejects.toThrow('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
      expect(prisma.deviceReturn.create).not.toHaveBeenCalled();
    });

    it('REPOSSESSION (TERMINATED): ไม่ส่งเหตุผล → ตั้ง AFTER_TERMINATION ให้; ส่งเหตุผลอื่น → 400; ไม่แตะสถานะสัญญา', async () => {
      arm(makeContract({ status: 'TERMINATED' }));
      await expect(
        service.create({ ...dto(), returnReason: 'UNAFFORDABLE' }, SALES_A as never),
      ).rejects.toThrow(/รับเครื่องคืนหลังบอกเลิกสัญญา/);
      await service.create({ ...dto(), returnReason: undefined }, SALES_A as never);
      const data = prisma.deviceReturn.create.mock.calls[0][0].data;
      expect(data.returnKind).toBe('REPOSSESSION');
      expect(data.returnReason).toBe('AFTER_TERMINATION');
      expect(data.previousContractStatus).toBeNull();
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('ราคาประเมิน 0 → 400 (spec §5.1 ข้อ 7)', async () => {
      arm();
      await expect(
        service.create({ ...dto(), appraisalPrice: 0 }, SALES_A as never),
      ).rejects.toThrow('กรุณาระบุราคาประเมินมากกว่า 0 บาท');
    });

    it('ต่างจากตารางเกิน 15% ต้องมีหมายเหตุ (400) — มีหมายเหตุแล้ว snapshot tableBasePrice', async () => {
      arm();
      prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: decimal(8000), note: null });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(/เกิน 15%/);
      await service.create({ ...dto(), notes: 'จอแตก' }, SALES_A as never);
      expect(String(prisma.deviceReturn.create.mock.calls[0][0].data.tableBasePrice)).toBe('8000');
    });

    it('ด่านสิทธิ์: ยอดค้าง 0 → 400; เครื่องเคยยึด → 409; มีใบ PENDING → 409; คำขอยกเลิกสัญญาค้าง → 400', async () => {
      const paid = makeContract().payments.map((p) => ({
        ...p,
        status: 'PAID',
        amountPaid: p.amountDue,
      }));
      arm(makeContract({ payments: paid }));
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(BadRequestException);

      arm();
      prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(ConflictException);

      prisma.deviceReturn.findFirst.mockResolvedValueOnce({ id: 'dr-open', docNumber: 'DR-x' });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(
        'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว',
      );

      prisma.contractCancellation.count.mockResolvedValueOnce(1);
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(/คำขอยกเลิกสัญญา/);
    });

    it('VOLUNTARY สำเร็จ: เลขที่จาก number service ใน tx, แถวใบ, สัญญา → TERMINATED + audit CONTRACT_STATUS_LEGAL ใน tx, หลัง commit audit/tag/ไลน์ ตามลำดับ, คืนแถว', async () => {
      arm();
      const result = await service.create(
        { ...dto(), repairCost: 150, notes: 'สภาพดี' },
        SALES_A as never,
      );

      expect(numberService.next).toHaveBeenCalledWith(prisma);
      expect(prisma.deviceReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            docNumber: 'DR-20260920-0001',
            contractId: 'contract-1',
            productId: 'product-1',
            customerId: 'cust-1',
            receivingBranchId: 'branch-a',
            receivedById: 'sales-a',
            returnKind: 'VOLUNTARY',
            returnReason: 'UNAFFORDABLE',
            conditionGrade: 'B',
            notes: 'สภาพดี',
            previousContractStatus: 'ACTIVE',
            status: 'PENDING_CONFIRM',
          }),
        }),
      );
      const data = prisma.deviceReturn.create.mock.calls[0][0].data;
      expect(String(data.appraisalPrice)).toBe('6000');
      expect(String(data.repairCost)).toBe('150');
      expect(data.tableBasePrice).toBeNull();
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { status: 'TERMINATED' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sales-a',
          action: 'CONTRACT_STATUS_LEGAL',
          entity: 'contract',
          entityId: 'contract-1',
          newValue: {
            from: 'ACTIVE',
            to: 'TERMINATED',
            reason: 'DEVICE_RETURN_INTAKE',
            deviceReturnId: 'dr-1',
            docNumber: 'DR-20260920-0001',
          },
        },
      });
      // post-commit ตามลำดับ: audit → tag → ไลน์ (ทุกตัวหลัง $transaction)
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(audit.log.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(tags.recomputeForCustomer.mock.invocationCallOrder[0]).toBeGreaterThan(
        audit.log.mock.invocationCallOrder[0],
      );
      expect(notify.notify.mock.invocationCallOrder[0]).toBeGreaterThan(
        tags.recomputeForCustomer.mock.invocationCallOrder[0],
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sales-a',
          action: 'DEVICE_RETURN_CREATED',
          entity: 'device_return',
          entityId: 'dr-1',
          newValue: expect.objectContaining({
            docNumber: 'DR-20260920-0001',
            contractNumber: 'BCP2609-00042',
            returnKind: 'VOLUNTARY',
            returnReason: 'UNAFFORDABLE',
            conditionGrade: 'B',
            appraisalPrice: '6000.00',
            tableBasePrice: null,
            receivingBranchId: 'branch-a',
          }),
        }),
      );
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURNED');
      expect(result).toMatchObject({
        id: 'dr-1',
        docNumber: 'DR-20260920-0001',
        status: 'PENDING_CONFIRM',
        appraisalPrice: '6000.00',
        repairCost: '0.00',
        lineNotifyStatus: 'SENT',
        receivingBranch: { id: 'branch-a', name: 'ลาดพร้าว' },
        contract: {
          contractNumber: 'BCP2609-00042',
          customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
        },
      });
    });

    it('OWNER ใช้ receivingBranchId จาก body; SALES ส่ง receivingBranchId มาถูกละเลย (ใช้สาขาตัวเอง)', async () => {
      arm();
      await service.create({ ...dto(), receivingBranchId: 'branch-x' }, OWNER as never);
      expect(prisma.deviceReturn.create.mock.calls[0][0].data.receivingBranchId).toBe('branch-x');
      await service.create({ ...dto(), receivingBranchId: 'branch-x' }, SALES_A as never);
      expect(prisma.deviceReturn.create.mock.calls[1][0].data.receivingBranchId).toBe('branch-a');
    });

    it('P2002 จาก partial unique (แพ้ race) → 409 ข้อความใบซ้ำ', async () => {
      arm();
      prisma.deviceReturn.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(
        'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว',
      );
    });

    it('recompute tag ล้ม → ไม่ throw ออก (best-effort) และไลน์ยังถูกส่ง', async () => {
      arm();
      tags.recomputeForCustomer.mockRejectedValueOnce(new Error('boom'));
      await expect(service.create(dto(), SALES_A as never)).resolves.toBeDefined();
      expect(notify.notify).toHaveBeenCalled();
    });

    it('uses the supplied transaction for intake writes and waits for commit before side effects', async () => {
      arm();
      const tx = {
        ...prisma,
        contract: {
          ...prisma.contract,
          findUnique: jest.fn().mockResolvedValue(makeContract()),
          update: jest.fn().mockResolvedValue({}),
        },
        deviceReturn: {
          ...prisma.deviceReturn,
          create: jest.fn().mockResolvedValue(makeReturnRow()),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      let releaseCommit!: () => void;
      let callbackFinished!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const callbackGate = new Promise<void>((resolve) => {
        callbackFinished = resolve;
      });
      prisma.$transaction.mockImplementationOnce(
        async (fn: (client: typeof tx) => Promise<unknown>) => {
          const result = await fn(tx);
          callbackFinished();
          await commitGate;
          return result;
        },
      );

      const result = service.create(dto(), SALES_A as never);
      try {
        await callbackGate;
        expect(numberService.next).toHaveBeenCalledWith(tx);
        expect(tx.deviceReturn.create).toHaveBeenCalledTimes(1);
        expect(tx.contract.update).toHaveBeenCalledTimes(1);
        expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.contract.findUnique).not.toHaveBeenCalled();
        expect(prisma.deviceReturn.create).not.toHaveBeenCalled();
        expect(prisma.contract.update).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
        expect(tags.recomputeForCustomer).not.toHaveBeenCalled();
        expect(notify.notify).not.toHaveBeenCalled();
      } finally {
        releaseCommit();
        await result;
      }
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(notify.notify).toHaveBeenCalledTimes(1);
    });

    it('a failed atomic status audit prevents all post-commit side effects', async () => {
      arm();
      const failure = new Error('atomic audit failed');
      prisma.auditLog.create.mockRejectedValueOnce(failure);
      await expect(service.create(dto(), SALES_A as never)).rejects.toBe(failure);
      expect(audit.log).not.toHaveBeenCalled();
      expect(tags.recomputeForCustomer).not.toHaveBeenCalled();
      expect(notify.notify).not.toHaveBeenCalled();
      expect(prisma.deviceReturn.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('a commit failure after the callback completes prevents post-commit side effects', async () => {
      arm();
      const failure = new Error('commit failed');
      prisma.$transaction.mockImplementationOnce(
        async (fn: (client: typeof prisma) => Promise<unknown>) => {
          await fn(prisma);
          throw failure;
        },
      );
      await expect(service.create(dto(), SALES_A as never)).rejects.toBe(failure);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(audit.log).not.toHaveBeenCalled();
      expect(tags.recomputeForCustomer).not.toHaveBeenCalled();
      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('protects the eligibility snapshot with Serializable and returns Thai 409 without retry on P2034', async () => {
      arm();
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(
        'ข้อมูลสัญญาเปลี่ยนระหว่างรับเครื่องคืน กรุณาตรวจสอบแล้วลองใหม่',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(audit.log).not.toHaveBeenCalled();
      expect(tags.recomputeForCustomer).not.toHaveBeenCalled();
      expect(notify.notify).not.toHaveBeenCalled();
    });

    it('exactly 15 percent deviation is accepted without notes', async () => {
      arm();
      prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: decimal(8000), note: null });
      await service.create({ ...dto(), appraisalPrice: 6800 }, SALES_A as never);
      expect(String(prisma.deviceReturn.create.mock.calls[0][0].data.tableBasePrice)).toBe('8000');
    });
  });

  describe('list / findOne / awaitingRepossession', () => {
    it('list: BM ถูกบังคับ receivingBranchId ตัวเอง แม้ส่ง branchId อื่น; default limit 50; แถวมี confirmedBy จาก user lookup', async () => {
      prisma.deviceReturn.findMany.mockResolvedValue([
        makeReturnRow({
          status: 'CONFIRMED',
          confirmedById: 'fm-1',
          confirmedAt: new Date('2026-09-21T02:00:00.000Z'),
          repossessionId: 'repo-1',
        }),
      ]);
      prisma.deviceReturn.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([{ id: 'fm-1', name: 'ผจก.การเงิน' }]);

      const result = await service.list(
        { branchId: 'branch-z', status: 'CONFIRMED' },
        BM_A as never,
      );

      const args = prisma.deviceReturn.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        deletedAt: null,
        status: 'CONFIRMED',
        receivingBranchId: 'branch-a',
      });
      expect(args.take).toBe(50);
      expect(args.skip).toBe(0);
      expect(result).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(result.data[0]).toMatchObject({
        status: 'CONFIRMED',
        confirmedBy: { id: 'fm-1', name: 'ผจก.การเงิน' },
        repossessionId: 'repo-1',
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['fm-1'] } },
        select: { id: true, name: true },
      });
    });

    it('list: BM ไม่มี branchId → หน้าว่างโดยไม่ query; OWNER ใช้ branchId/contractId จาก query', async () => {
      expect(
        await service.list({}, { id: 'u', role: 'BRANCH_MANAGER', branchId: null } as never),
      ).toEqual({ data: [], total: 0, page: 1, limit: 50 });
      expect(prisma.deviceReturn.findMany).not.toHaveBeenCalled();
      await service.list(
        { branchId: 'branch-z', contractId: 'contract-9', page: 2, limit: 10 },
        OWNER as never,
      );
      const args = prisma.deviceReturn.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        deletedAt: null,
        receivingBranchId: 'branch-z',
        contractId: 'contract-9',
      });
      expect(args.skip).toBe(10);
    });

    it('findOne: BM สาขาอื่น → 404 (ไม่ leak); FM (cross-branch) → ผ่าน', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({ receivingBranchId: 'branch-b' }),
      );
      await expect(service.findOne('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
      expect((await service.findOne('dr-1', FM as never)).docNumber).toBe('DR-20260920-0001');
    });

    it('awaitingRepossession: TERMINATED ที่ไม่มีแถวยึดและไม่มีใบ PENDING; BM กรอง contract.branchId ตัวเอง; limit 100', async () => {
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c1',
          contractNumber: 'BCP-1',
          status: 'TERMINATED',
          monthlyPayment: decimal('1515.83'),
          customer: { id: 'cu1', name: 'x', phone: '08' },
          product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '14' },
          branch: { id: 'branch-a', name: 'ลาดพร้าว' },
        },
      ]);
      prisma.contract.count.mockResolvedValue(1);
      const result = await service.awaitingRepossession(BM_A as never);
      const args = prisma.contract.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        deletedAt: null,
        status: 'TERMINATED',
        repossession: null,
        deviceReturns: { none: { status: 'PENDING_CONFIRM', deletedAt: null } },
        branchId: 'branch-a',
      });
      expect(args.take).toBe(100);
      expect(result).toEqual({
        data: [
          {
            id: 'c1',
            contractNumber: 'BCP-1',
            status: 'TERMINATED',
            monthlyPayment: '1515.83',
            customer: { id: 'cu1', name: 'x', phone: '08' },
            product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '14' },
            branch: { id: 'branch-a', name: 'ลาดพร้าว' },
          },
        ],
        total: 1,
      });
    });
  });
  describe('confirm (FINANCE)', () => {
    const pending = () => makeReturnRow();

    it('PENDING → createInTx ด้วยข้อมูลจากใบ (เกรด/ราคา/วันรับ/ผู้ตรวจ/สาขา/deviceReturnId + company ids), CAS → CONFIRMED, หลัง commit audit/journey/tag/ส่ง CN', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'CONFIRMED', confirmedById: 'fm-1', repossessionId: 'repo-1' }),
      );
      prisma.user.findMany.mockResolvedValue([{ id: 'fm-1', name: 'ผจก.การเงิน' }]);

      let committed = false;
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const result = await fn(prisma);
        committed = true;
        return result;
      });
      for (const effect of [
        audit.log,
        journey.recordAfterCommit,
        tags.recomputeForCustomer,
        cnDelivery.deliver,
      ]) {
        effect.mockImplementation(async () => {
          expect(committed).toBe(true);
        });
      }

      const result = await service.confirm('dr-1', { discountPct: 40 }, FM as never);

      expect(repossessions.assertRepossessionPeriodsOpen).toHaveBeenCalledWith(expect.any(Date));
      expect(repossessions.createInTx).toHaveBeenCalledWith(
        prisma, // tx
        {
          contractId: 'contract-1',
          repossessedDate: new Date('2026-09-20T03:00:00.000Z'),
          paymentDate: expect.any(Date),
          conditionGrade: 'B',
          appraisalPrice: 6000,
          repairCost: 0,
          notes: undefined,
          returnReason: 'UNAFFORDABLE',
          discountPct: 40,
          appraisedById: 'sales-a',
          receivingBranchId: 'branch-a',
          deviceReturnId: 'dr-1',
          financeCompanyId: 'company-finance',
          shopCompanyId: 'company-shop',
        },
        'fm-1',
      );
      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: { status: 'CONFIRMED', confirmedById: 'fm-1', confirmedAt: expect.any(Date) },
      });
      expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
        where: { id: 'dr-1' },
        data: { repossessionId: 'repo-1' },
      });
      expect(prisma.deviceReturn.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        repossessions.createInTx.mock.invocationCallOrder[0],
      );
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(audit.log.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'fm-1',
          action: 'DEVICE_RETURN_CONFIRMED',
          entity: 'device_return',
          entityId: 'dr-1',
          newValue: expect.objectContaining({
            docNumber: 'DR-20260920-0001',
            repossessionId: 'repo-1',
            outstandingBalance: '2100.00',
            creditNote: 'ISSUED',
          }),
        }),
      );
      expect(journey.recordAfterCommit).toHaveBeenCalledWith({
        customerId: 'cust-1',
        kind: 'DEVICE_RETURNED',
        occurredAt: new Date('2026-09-20T03:00:00.000Z'),
        actorType: 'STAFF',
        actorUserId: 'fm-1',
        refType: 'contract',
        refId: 'contract-1',
        data: {
          docNumber: 'DR-20260920-0001',
          contractNumber: 'BCP2609-00042',
          returnKind: 'VOLUNTARY',
          returnReason: 'UNAFFORDABLE',
        },
        dedupeKey: 'DEVICE_RETURNED:dr-1',
      });
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(cnDelivery.deliver).toHaveBeenCalledWith('r1');
      expect(cnDelivery.deliver.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(notify.notify).not.toHaveBeenCalled(); // ยืนยันไม่ส่งไลน์ซ้ำ — ลูกค้าได้ CN ทางไลน์จาก create path อยู่แล้ว
      expect(result).toMatchObject({
        status: 'CONFIRMED',
        repossessionId: 'repo-1',
        confirmedBy: { id: 'fm-1', name: 'ผจก.การเงิน' },
        creditNote: { outcome: 'ISSUED', receiptId: 'r1' },
      });
    });

    it('paymentDate จาก dto ถูกส่งเข้า assertRepossessionPeriodsOpen และ createInTx; period guard throw → ไม่เปิด tx', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      repossessions.assertRepossessionPeriodsOpen.mockRejectedValueOnce(
        new BadRequestException('วันที่รับเงินต้องไม่เป็นวันในอนาคต'),
      );
      await expect(
        service.confirm('dr-1', { paymentDate: '2099-01-01' }, FM as never),
      ).rejects.toThrow(/อนาคต/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ใบไม่ใช่ PENDING → 409 CLOSED_MSG ก่อน period guard; ใบไม่พบ → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'REJECTED' }));
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(
        'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว',
      );
      expect(repossessions.assertRepossessionPeriodsOpen).not.toHaveBeenCalled();
      prisma.deviceReturn.findFirst.mockResolvedValue(null);
      await expect(service.confirm('missing', {}, FM as never)).rejects.toThrow(NotFoundException);
    });

    it('CAS แพ้ (count 0 — อีกคนยืนยันก่อน) → 409 และ rollback (throw ออกจาก tx)', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(ConflictException);
      expect(repossessions.createInTx).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(cnDelivery.deliver).not.toHaveBeenCalled();
    });

    it('createInTx โยน (เช่น ยอดค้าง 0 เพราะ webhook จ่ายหมดระหว่างรอ) → error เดิมทะลุออก ไม่มี post-commit', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      repossessions.createInTx.mockRejectedValueOnce(
        new BadRequestException('สัญญานี้ไม่มียอดค้างชำระ'),
      );
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(/ไม่มียอดค้างชำระ/);
      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.deviceReturn.update).not.toHaveBeenCalled();
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('P2002 ใน tx (แพ้ race ของ Repossession.productId unique) → 409 RE_REPOSSESSION_MSG', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      repossessions.createInTx.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(/เคยถูกยึดคืนมาแล้ว/);
    });

    it('CN ไม่ได้ออก (SKIPPED_NO_ACCRUED) → ไม่เรียก deliver; creditNote ในผลลัพธ์ยังมี outcome', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'CONFIRMED' }),
      );
      repossessions.createInTx.mockResolvedValueOnce({
        repossession: { id: 'repo-1' },
        outstandingBalance: decimal(2100),
        totalPaid: decimal(1000),
        creditNote: { outcome: 'SKIPPED_NO_ACCRUED' },
      });
      const result = await service.confirm('dr-1', {}, FM as never);
      expect(cnDelivery.deliver).not.toHaveBeenCalled();
      expect(result.creditNote).toEqual({ outcome: 'SKIPPED_NO_ACCRUED' });
    });
  });

  describe('reject / cancel', () => {
    it('reject VOLUNTARY: CAS → REJECTED + คืนสถานะสัญญาเดิม (CAS TERMINATED→previous) + audit CONTRACT_STATUS_LEGAL ใน tx; หลัง commit audit/tag/ไลน์ยกเลิก', async () => {
      // deviceReceivedAt = วันนี้ → ไม่ข้ามเดือน → notice null (fixture วันตายตัวจะทำให้เทสแดงเมื่อเดือนเปลี่ยน)
      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({ deviceReceivedAt: new Date() }),
      );
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'REJECTED', rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }),
      );

      const result = await service.reject(
        'dr-1',
        { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' },
        FM as never,
      );

      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: {
          status: 'REJECTED',
          rejectedById: 'fm-1',
          rejectedAt: expect.any(Date),
          rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่',
        },
      });
      expect(prisma.contract.updateMany).toHaveBeenCalledWith({
        where: { id: 'contract-1', status: 'TERMINATED' },
        data: { status: 'ACTIVE' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'fm-1',
          action: 'CONTRACT_STATUS_LEGAL',
          entity: 'contract',
          entityId: 'contract-1',
          newValue: {
            from: 'TERMINATED',
            to: 'ACTIVE',
            reason: 'DEVICE_RETURN_REJECTED',
            deviceReturnId: 'dr-1',
            docNumber: 'DR-20260920-0001',
          },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'fm-1',
          action: 'DEVICE_RETURN_REJECTED',
          entity: 'device_return',
          entityId: 'dr-1',
          newValue: expect.objectContaining({
            docNumber: 'DR-20260920-0001',
            reason: 'ใบผิดสัญญา กรุณาตรวจใหม่',
            contractStatusRestored: 'ACTIVE',
          }),
        }),
      );
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');
      expect(result).toMatchObject({
        status: 'REJECTED',
        rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่',
        notice: null,
      });
    });

    it('reject ใบข้ามเดือน (รับเครื่องเดือนก่อน) → notice บอกให้เปิดงวดถ้าปิดแล้ว (accrual ย้อนหลังติด validatePeriodOpen)', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({ deviceReceivedAt: new Date('2020-01-15T03:00:00.000Z') }),
      );
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'REJECTED' }),
      );
      const result = await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(result.notice).toMatch(/PERIOD_REOPENED/);
    });

    it('reject REPOSSESSION: ไม่แตะสถานะสัญญา ไม่มี CONTRACT_STATUS_LEGAL', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({
          returnKind: 'REPOSSESSION',
          returnReason: 'AFTER_TERMINATION',
          previousContractStatus: null,
        }),
      );
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'REJECTED' }),
      );
      await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(prisma.contract.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('reject: สัญญาถูกเปลี่ยนสถานะระหว่างรอ (CAS สัญญา count 0) → ยังส่งกลับได้ แต่บันทึกว่าไม่ได้คืนสถานะ', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'REJECTED' }),
      );
      prisma.contract.updateMany.mockResolvedValueOnce({ count: 0 });
      await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ contractStatusRestored: null }),
        }),
      );
    });

    it('reject: ใบไม่ใช่ PENDING → 409; CAS แพ้ → 409', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED' }));
      await expect(
        service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never),
      ).rejects.toThrow(ConflictException);
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never),
      ).rejects.toThrow(ConflictException);
    });

    it('cancel: OWNER ยกเลิกใบสาขาใดก็ได้ → CANCELED + คืนสถานะ + audit DEVICE_RETURN_CANCELED + ไลน์', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'CANCELED' }),
      );
      const result = await service.cancel('dr-1', OWNER as never);
      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: { status: 'CANCELED', canceledById: 'owner-1', canceledAt: expect.any(Date) },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            newValue: expect.objectContaining({ reason: 'DEVICE_RETURN_CANCELED' }),
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEVICE_RETURN_CANCELED' }),
      );
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');
      expect(result.status).toBe('CANCELED');
    });

    it('cancel: BM ยกเลิกได้เฉพาะใบสาขาตัวเอง (สาขาอื่น → 404 ไม่ leak); BM ไม่มี branchId → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({ receivingBranchId: 'branch-b' }),
      );
      await expect(service.cancel('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
      await expect(
        service.cancel('dr-1', { id: 'bm', role: 'BRANCH_MANAGER', branchId: null } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.deviceReturn.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('resendLine', () => {
    it('PENDING/CONFIRMED → ส่ง DEVICE_RETURNED; REJECTED/CANCELED → DEVICE_RETURN_CANCELED; audit DEVICE_RETURN_LINE_RESENT; BM สาขาอื่น → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED' }));
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(
        makeReturnRow({ status: 'CONFIRMED', lineNotifyStatus: 'SENT' }),
      );
      const result = await service.resendLine('dr-1', BM_A as never);
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURNED');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEVICE_RETURN_LINE_RESENT',
          entityId: 'dr-1',
          newValue: expect.objectContaining({
            eventType: 'DEVICE_RETURNED',
            lineNotifyStatus: 'SENT',
          }),
        }),
      );
      expect(result.lineNotifyStatus).toBe('SENT');

      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CANCELED' }));
      await service.resendLine('dr-1', FM as never);
      expect(notify.notify).toHaveBeenLastCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');

      prisma.deviceReturn.findFirst.mockResolvedValue(
        makeReturnRow({ receivingBranchId: 'branch-b' }),
      );
      await expect(service.resendLine('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
    });
  });
});
