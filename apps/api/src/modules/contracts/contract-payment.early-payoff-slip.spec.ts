import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractPaymentService, type SlipMatchAuthorization } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';

/**
 * ปิดสัญญาก่อนกำหนด "ทางสลิปตรง" (คำสั่งเจ้าของ 2026-09-24) — earlyPayoff() รับ slipMatch แทนคำขออนุมัติ:
 * ใน tx เดียวกับ JE ต้อง (1) ยอดปิดสดตรงกับสลิป ±0.01 (2) ลายนิ้วมือสลิปยังไม่ถูกใช้ (unique → 409)
 * (3) เขียน PaymentEvidence + AuditLog EARLY_PAYOFF_SLIP_MATCHED. fixture เดียวกับ early-payoff-park.spec
 * (ยอดปิดไม่มีถังพัก = 11,106.00)
 */
describe('ContractPaymentService.earlyPayoff — slipMatch (ไม่ผ่านคิวอนุมัติ)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const makeQuoteContract = (park: string) => ({
    id: 'contract-ep-park-1',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-park-1',
    totalMonths: 12,
    monthlyPayment: dec('1926.00'),
    creditBalance: dec('0'),
    rescheduleAdvanceBalance: dec(park),
    vatPct: dec('0.07'),
    sellingPrice: dec('20000'),
    downPayment: dec('2000'),
    storeCommission: dec('1800'),
    financedAmount: dec('18000'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        status: 'PAID',
        amountPaid: dec('1926.00'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 7,
        status: 'PENDING',
        amountPaid: dec('0'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    ],
  });

  type CapturedLine = { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal };
  type CapturedJe = { metadata: Record<string, unknown>; lines: CapturedLine[] };

  type Harness = {
    service: ContractPaymentService;
    createAndPost: jest.Mock;
    contractUpdates: Array<Record<string, unknown>>;
    auditRows: Array<Record<string, unknown>>;
    fingerprints: Array<Record<string, unknown>>;
    evidenceRows: Array<Record<string, unknown>>;
  };

  const build = (park: string, fingerprintTaken = false): Harness => {
    const contract = makeQuoteContract(park);
    const contractUpdates: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    const fingerprints: Array<Record<string, unknown>> = [];
    const evidenceRows: Array<Record<string, unknown>> = [];

    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-ep-park', entryNumber: 'JE-EP-PARK-0001' });

    const tx = {
      contract: {
        // ทางสลิปตรงคิดยอดปิดสดใน tx (getEarlyPayoffQuote(id, …, tx)) จึงต้องได้สัญญาเต็มตัว
        findUnique: jest.fn().mockResolvedValue({
          ...contract,
          contractNumber: 'CT-EP-PARK-001',
          branchId: 'branch-1',
        }),
        // ฉบับสดใน tx — ต้องมีคอลัมน์ถังพัก (clamp ชั้นที่สองอ่านจากตัวนี้)
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: contract.id,
          totalMonths: 12,
          financedAmount: dec('18000'),
          storeCommission: dec('1800'),
          interestTotal: dec('1800'),
          vatAmount: dec('1512.00'),
          rescheduleAdvanceBalance: dec(park),
        }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          contractUpdates.push(data);
          return Promise.resolve({ productId: contract.productId });
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 6 }, (_, i) => ({
            id: `pay-${i + 7}`,
            installmentNo: i + 7,
            status: 'PENDING',
            amountDue: dec('1926.00'),
            amountPaid: dec('0'),
            monthlyPrincipal: dec('1500'),
            monthlyInterest: dec('150'),
            monthlyCommission: dec('150'),
            vatAmount: dec('126'),
            lateFee: dec('0'),
            lateFeeWaived: false,
            evidenceUrl: null,
            gatewayRef: null,
          })),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return Promise.resolve(data);
        }),
      },
      // ทางสลิปตรง — ลายนิ้วมือ (unique) + หลักฐาน
      slipFingerprint: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          if (fingerprintTaken) {
            const err = new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'test',
            });
            return Promise.reject(err);
          }
          fingerprints.push(data);
          return Promise.resolve(data);
        }),
      },
      paymentEvidence: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          evidenceRows.push(data);
          return Promise.resolve({ id: 'ev-1', ...data });
        }),
      },
      // R-3 (re-review 2026-08-18): JP4 now clamps `parkRelief` by the LIVE GL
      // balance of 21-1103 for this contract — the same policy JP5 already used —
      // so the ledger has to BACK the column here or the relief clamps to zero.
      // That is exactly right: the 6a/6b fee JE credited 21-1103 by the parked
      // amount, so a contract whose column says `park` has a matching Cr balance.
      // Scoped by accountCode so other journalLine reads on this path stay empty.
      journalLine: {
        findMany: jest
          .fn()
          .mockImplementation((args: { where?: { accountCode?: string } }) =>
            Promise.resolve(
              args?.where?.accountCode === '21-1103'
                ? [{ debit: dec('0'), credit: dec(park) }]
                : [],
            ),
          ),
      },
      badDebtProvision: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      installmentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }))),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }))),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: { companyCode: string } }) =>
            Promise.resolve({ id: `co-${args.where.companyCode}` }),
          ),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };

    const service = new ContractPaymentService(
      prisma as never,
      { transferOwnership: jest.fn().mockResolvedValue(undefined) } as never,
      { createAndPost } as never,
      {} as never,
      {} as never,
      { generateReceipt: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-1' }) } as never,
    );

    return { service, createAndPost, contractUpdates, auditRows, fingerprints, evidenceRows };
  };

  const slipMatch = (amount = 11106): SlipMatchAuthorization => ({
    imageKey: 'early-payoff-slips/contract-ep-park-1/slip.jpg',
    hash: 'abc123',
    amount,
    refNo: '2026092318425510',
    bankName: 'KBANK',
    date: '2026-09-23',
    confidence: 0.97,
  });
  const dto: EarlyPayoffDto = {
    paymentMethod: 'BANK_TRANSFER',
    depositAccountCode: '11-1201',
    slipUrl: 'https://storage.example/slip.jpg',
    referenceNo: '2026092318425510',
  };

  it('ไม่มีทั้งคำขออนุมัติและสลิป → 403 (ทางเข้าเดิมยังปิดอยู่)', async () => {
    const h = build('0');
    await expect(h.service.earlyPayoff('contract-ep-park-1', 'user-1', dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.createAndPost).not.toHaveBeenCalled();
  });

  it('สลิปตรง → JE JP4 เดิม + ลายนิ้วมือ + หลักฐาน + audit EARLY_PAYOFF_SLIP_MATCHED ใน tx เดียว · สัญญาเป็น EARLY_PAYOFF', async () => {
    const h = build('0');
    const res = await h.service.earlyPayoff(
      'contract-ep-park-1',
      'user-1',
      dto,
      undefined,
      slipMatch(),
    );
    expect(res.status).toBe('EARLY_PAYOFF');
    expect(res.totalPayoff).toBe(11106);
    expect(h.createAndPost).toHaveBeenCalledTimes(1);
    expect(h.fingerprints).toEqual([{ hash: 'abc123', contractId: 'contract-ep-park-1' }]);
    expect(h.evidenceRows[0]).toMatchObject({
      contractId: 'contract-ep-park-1',
      imageUrl: 'early-payoff-slips/contract-ep-park-1/slip.jpg',
      amount: 11106,
      status: 'APPROVED',
      reviewedById: 'user-1',
      reviewNote: 'EARLY_PAYOFF_SLIP_MATCH',
    });
    const audit = h.auditRows.find((r) => r.action === 'EARLY_PAYOFF_SLIP_MATCHED');
    expect(audit).toMatchObject({
      entity: 'contract',
      entityId: 'contract-ep-park-1',
      userId: 'user-1',
    });
    expect(audit!.newValue).toMatchObject({
      totalPayoff: '11106.00',
      slipAmount: '11106.00',
      refNo: '2026092318425510',
      hash: 'abc123',
    });
    expect(h.contractUpdates.some((d) => d.status === 'EARLY_PAYOFF')).toBe(true);
  });

  it('ยอดปิดสดไม่ตรงกับสลิป (เกิน 0.01) → 409 ไม่โพสต์ JE ไม่เขียนลายนิ้วมือ', async () => {
    const h = build('0');
    await expect(
      h.service.earlyPayoff('contract-ep-park-1', 'user-1', dto, undefined, slipMatch(11000)),
    ).rejects.toThrow(ConflictException);
    expect(h.createAndPost).not.toHaveBeenCalled();
    expect(h.fingerprints).toHaveLength(0);
    expect(h.evidenceRows).toHaveLength(0);
  });

  it('ยอดต่าง 0.01 ยังผ่าน (ปัดเศษ)', async () => {
    const h = build('0');
    const res = await h.service.earlyPayoff(
      'contract-ep-park-1',
      'user-1',
      dto,
      undefined,
      slipMatch(11106.01),
    );
    expect(res.status).toBe('EARLY_PAYOFF');
  });

  it('ลายนิ้วมือสลิปชน (P2002 — เคยใช้กับบอท/ปิดยอดอื่น) → 409 ภาษาไทย ไม่โพสต์ JE', async () => {
    const h = build('0', true);
    await expect(
      h.service.earlyPayoff('contract-ep-park-1', 'user-1', dto, undefined, slipMatch()),
    ).rejects.toThrow(/สลิปนี้ถูกใช้/);
    expect(h.createAndPost).not.toHaveBeenCalled();
    expect(h.evidenceRows).toHaveLength(0);
  });
});
