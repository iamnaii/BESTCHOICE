import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OverdueService } from './overdue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { OverdueKpiService } from './kpi.service';
import { PromiseService } from './promise.service';
import { PaymentsService } from '../payments/payments.service';
import { ContractLetterService } from './contract-letter.service';
import { MdmLockService } from './mdm-lock.service';
import { OwnerAlertHelper } from './owner-alert.helper';
import { ConsecutiveMissedService } from './consecutive-missed.service';

/**
 * Characterization (golden) test for OverdueService.partialPaymentReschedule
 * (overdue.service.ts ~lines 1410-1535).
 *
 * Locks the outstanding-recompute math for "รับเงินบางส่วน + นัดส่วนที่เหลือ":
 *   outstandingBefore = Σ (amountDue + lateFee − amountPaid) over PAST-DUE installments
 *   outstandingAfter  = outstandingBefore − amountPaid
 *   isFullPayment     = (amountPaid === outstandingBefore)
 *
 * The reschedule of the remaining balance is delegated to this.logContact
 * (result=PROMISED, settlementAmount=outstandingAfter). That method has its own
 * complex prisma+PromiseService side effects, so it is spied/stubbed here to keep
 * this test focused on the money computation + branch flags. The returned
 * settlementAmount passed INTO logContact is itself asserted (it is the recomputed
 * remaining installment amount), so the reschedule value is still locked.
 *
 * All amounts are Prisma.Decimal under the hood; the method returns plain numbers
 * via .toNumber(), so equality on whole/decimal values is exact.
 */
describe('OverdueService.partialPaymentReschedule (characterization)', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const mockDunningEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };
  const mockKpiService = { invalidate: jest.fn() };
  const mockPromiseService = {
    createPromise: jest.fn().mockResolvedValue({ id: 'promise-1' }),
    findActivePromise: jest.fn().mockResolvedValue(null),
    calcCycleDeadline: jest.fn(),
  };
  const mockLetterService = { createIfNotExists: jest.fn() };
  const mockMdmLockService = { proposeManual: jest.fn() };
  const mockOwnerAlertHelper = {
    sendToAllOwners: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  };
  // autoAllocatePayment is the atomic money receipt — its return is opaque to the
  // computation under test; we only echo a marker so we can confirm it was wired.
  const mockPaymentsService = {
    autoAllocatePayment: jest.fn().mockResolvedValue({ receiptId: 'rcpt-1' }),
  };

  // Helper: build a contract whose PAST-DUE payments produce a known outstanding.
  // partialPaymentReschedule selects amountDue/amountPaid/lateFee for past-due rows.
  const futureIso = (days: number) =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const buildContract = () => ({
    id: 'c-1',
    payments: [
      // remaining = 1000 + 50 - 0   = 1050
      { amountDue: new Prisma.Decimal('1000'), lateFee: new Prisma.Decimal('50'), amountPaid: new Prisma.Decimal('0') },
      // remaining = 1000 + 50 - 200 = 850
      { amountDue: new Prisma.Decimal('1000'), lateFee: new Prisma.Decimal('50'), amountPaid: new Prisma.Decimal('200') },
      // remaining = 1000 + 0  - 0   = 1000
      { amountDue: new Prisma.Decimal('1000'), lateFee: new Prisma.Decimal('0'), amountPaid: new Prisma.Decimal('0') },
    ],
    // outstandingBefore = 1050 + 850 + 1000 = 2900.00
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue(buildContract()) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueService,
        { provide: PrismaService, useValue: prisma },
        { provide: DunningEngineService, useValue: mockDunningEngine },
        { provide: OverdueKpiService, useValue: mockKpiService },
        { provide: PromiseService, useValue: mockPromiseService },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: ContractLetterService, useValue: mockLetterService },
        { provide: MdmLockService, useValue: mockMdmLockService },
        { provide: OwnerAlertHelper, useValue: mockOwnerAlertHelper },
        { provide: ConsecutiveMissedService, useValue: { getStreaks: jest.fn().mockResolvedValue(new Map()) } },
      ],
    }).compile();
    service = mod.get(OverdueService);

    // Isolate the reschedule-of-remainder side effect: logContact has its own
    // prisma + PromiseService machinery (broken-promise count, FIFO targeting,
    // Serializable $transaction). We stub it and assert the args it RECEIVES so the
    // recomputed remaining amount is still locked without a real DB.
    jest
      .spyOn(service, 'logContact')
      .mockResolvedValue({ id: 'cl-reschedule' } as never);
  });

  it('partial payment: recomputes outstanding and reschedules the EXACT remainder', async () => {
    const settlementDate = futureIso(3);
    const result = await service.partialPaymentReschedule('c-1', 'u-1', {
      amountPaid: 500,
      paymentMethod: 'CASH',
      newSettlementDate: settlementDate,
      notes: 'จ่าย 500 นัดที่เหลือ',
    });

    // outstandingBefore = 1050 + 850 + 1000 = 2900.00
    expect(result.outstandingBefore).toBe(2900);
    // outstandingAfter = 2900 - 500 = 2400.00 (the rescheduled remaining balance)
    expect(result.outstandingAfter).toBe(2400);
    expect(result.amountPaid).toBe(500);
    expect(result.isFullPayment).toBe(false);
    expect(result.newSettlementDate).toBe(settlementDate);

    // Money receipt was wired with the paid amount + method.
    expect(mockPaymentsService.autoAllocatePayment).toHaveBeenCalledWith(
      'c-1',
      500,
      'CASH',
      'u-1',
      expect.anything(),
      undefined,
    );

    // The reschedule (logContact PROMISED) carries the recomputed remainder 2400
    // as settlementAmount — this is the load-bearing regulated value.
    const logArgs = (service.logContact as jest.Mock).mock.calls[0];
    expect(logArgs[2]).toMatchObject({
      result: 'PROMISED',
      settlementAmount: 2400,
      settlementDate,
    });
  });

  it('folds transactionRef into the notes passed to autoAllocatePayment', async () => {
    await service.partialPaymentReschedule('c-1', 'u-1', {
      amountPaid: 500,
      paymentMethod: 'TRANSFER',
      newSettlementDate: futureIso(3),
      notes: 'โอนแล้ว',
      transactionRef: 'KB-998877',
    });

    // ref + notes both present → "Ref: <ref> — <notes>"
    const notesArg = mockPaymentsService.autoAllocatePayment.mock.calls[0][4];
    expect(notesArg).toBe('Ref: KB-998877 — โอนแล้ว');
  });

  it('full payment (paid === outstandingBefore): outstandingAfter=0, no reschedule', async () => {
    const result = await service.partialPaymentReschedule('c-1', 'u-1', {
      amountPaid: 2900, // exactly clears the 2900.00 outstanding
      paymentMethod: 'CASH',
    });

    expect(result.isFullPayment).toBe(true);
    expect(result.outstandingBefore).toBe(2900);
    expect(result.outstandingAfter).toBe(0);
    expect(result.newSettlementDate).toBeNull();
    // Full payment → no promise/reschedule logged.
    expect(service.logContact).not.toHaveBeenCalled();
  });

  it('rejects overpayment beyond total outstanding', async () => {
    await expect(
      service.partialPaymentReschedule('c-1', 'u-1', {
        amountPaid: 2900.01, // > 2900.00 outstanding
        paymentMethod: 'CASH',
        newSettlementDate: futureIso(3),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPaymentsService.autoAllocatePayment).not.toHaveBeenCalled();
  });

  it('rejects when contract has no outstanding (all past-due fully paid)', async () => {
    prisma.contract.findFirst.mockResolvedValue({
      id: 'c-1',
      payments: [
        { amountDue: new Prisma.Decimal('1000'), lateFee: new Prisma.Decimal('0'), amountPaid: new Prisma.Decimal('1000') },
      ],
    });
    await expect(
      service.partialPaymentReschedule('c-1', 'u-1', {
        amountPaid: 100,
        paymentMethod: 'CASH',
        newSettlementDate: futureIso(3),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('partial payment requires a future settlement date within 30 days', async () => {
    // Missing newSettlementDate on a partial pay → reject before taking any money.
    await expect(
      service.partialPaymentReschedule('c-1', 'u-1', {
        amountPaid: 500,
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(BadRequestException);

    // > 30 days out → reject.
    await expect(
      service.partialPaymentReschedule('c-1', 'u-1', {
        amountPaid: 500,
        paymentMethod: 'CASH',
        newSettlementDate: futureIso(31),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPaymentsService.autoAllocatePayment).not.toHaveBeenCalled();
  });

  it('throws NotFound when the contract is missing', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(
      service.partialPaymentReschedule('missing', 'u-1', {
        amountPaid: 500,
        paymentMethod: 'CASH',
        newSettlementDate: futureIso(3),
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
