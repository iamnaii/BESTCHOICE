jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { GatewayPayoffMismatchError, type GatewayMatchAuthorization } from './early-payoff-gateway';
import { EarlyPayoffDto } from './dto/contract.dto';
import { ledgerLines } from '../journal/__tests__/ledger-lines-mock';

/**
 * Task 41 (คำตัดสินเจ้าของ #43) — ทางเข้าที่สามของ earlyPayoff(): ลูกค้าปิดยอดเองผ่าน QR (gatewayMatch — ผู้เรียกเดียวคือ webhook PaySolutions)
 * fixture เดียวกับ early-payoff-slip.spec (ยอดปิดไม่มีถังพัก = 11,106.00):
 * - ลงในธุรกรรมของ webhook (ไม่เปิด $transaction เอง) · ไม่ตรวจผู้ทำรายการแบบพนักงาน · ยอดปิดสดต้องตรงเงินที่รับ ±0.01 (ไม่ตรง = GatewayPayoffMismatchError)
 * - audit EARLY_PAYOFF_GATEWAY_MATCHED ใน tx · ช่อง gateway ของแถวงวด · metadata ของ JP4
 * - ใบ EARLY_PAYOFF / journey / สัญญาณเตือน ไม่เกิดก่อน webhook commit (ผ่าน onCommit เท่านั้น) · journey ผู้กระทำ = ลูกค้า
 */
describe('ContractPaymentService.earlyPayoff — gatewayMatch (ลูกค้าปิดยอดเองผ่าน QR)', () => {
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

  const build = (park: string, fingerprintTaken = false) => {
    const contract = makeQuoteContract(park);
    const ledger = ledgerLines({
      '11-2101': '10800.00',
      '11-2105': '756.00',
      '11-2106': '900.00',
      '21-2102': '756.00',
      '21-1103': park,
    });
    const contractUpdates: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    const fingerprints: Array<Record<string, unknown>> = [];
    const evidenceRows: Array<Record<string, unknown>> = [];

    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-ep-park', entryNumber: 'JE-EP-PARK-0001' });

    const tx = {
      // Current persisted legacy admission is checked inside the money transaction.
      $queryRaw: jest.fn().mockResolvedValue([]),
      // #24: earlyPayoff reads approved-but-not-bank-confirmed refunds under the contract lock — none in this fixture
      refund: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true, deletedAt: null, accessManaged: false }) },
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
      // R-3 (re-review 2026-08-18): JP4 clamps `parkRelief` by the LIVE GL
      // balance of 21-1103 for this contract — the same policy JP5 already used —
      // so the ledger has to BACK the column here or the relief clamps to zero.
      // PR5: JP4 ล้างลูกหนี้ตามยอดในบัญชี — ยอดหลัง 6 งวดที่ตั้งลูกหนี้งวด + รับครบ (fixture เดียวกับ park spec)
      // PR4: advanceVatOutstanding อ่าน stamp จาก journalEntry — ไม่มีรายการที่ประทับในฟิกซ์เจอร์นี้
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn(ledger) },
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
      // preview นอก tx (ยอดปิดก่อนเปิดธุรกรรม) อ่านยอดในบัญชีชุดเดียวกัน
      // PR4: advanceVatOutstanding อ่าน stamp จาก journalEntry — ไม่มีรายการที่ประทับในฟิกซ์เจอร์นี้
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn(ledger) },
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

    const receipts = { generateReceipt: jest.fn().mockResolvedValue({ receiptNumber: 'RT-202611-00001' }) };
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractPaymentService(
      prisma as never,
      { transferOwnership: jest.fn().mockResolvedValue(undefined) } as never,
      { createAndPost } as never,
      {} as never,
      {} as never,
      receipts as never,
      { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-1' }) } as never,
      journey as never,
    );

    return { service, createAndPost, contractUpdates, auditRows, fingerprints, evidenceRows, tx, prisma, receipts, journey };
  };

  const dto: EarlyPayoffDto = {
    paymentMethod: 'ONLINE_GATEWAY',
    discountPct: 50,
    depositAccountCode: '11-1202',
    paymentDate: '2026-11-03T05:00:00.000Z',
    referenceNo: 'TX-41',
    notes: 'ชำระผ่าน Pay Solutions (TX-41)',
  };

  const gateway = (
    h: ReturnType<typeof build>,
    paid = '11106.00',
  ): GatewayMatchAuthorization & { work: Array<() => Promise<void>> } => {
    const work: Array<() => Promise<void>> = [];
    return {
      tx: h.tx as never,
      paidAmount: dec(paid),
      refno: '793700000041',
      transactionId: 'TX-41',
      paymentLinkId: 'track-41',
      quoteSnapshot: { totalPayoff: '11106.00', discountPct: 50, quoteDate: '2026-11-03' },
      webhookData: { refno: '793700000041', result_code: '00', total: paid },
      onCommit: (w) => work.push(w),
      work,
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('ยอดตรง → JP4 ในธุรกรรมของ webhook (ไม่เปิด $transaction) · ไม่ตรวจผู้ทำรายการแบบพนักงาน · audit + ช่อง gateway + metadata', async () => {
    const h = build('0');
    const g = gateway(h);

    const res = await h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, g);

    expect(res.status).toBe('EARLY_PAYOFF');
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.tx.user.findUnique).not.toHaveBeenCalled();
    expect(h.createAndPost).toHaveBeenCalledTimes(1);
    const [jeInput, jeClient] = h.createAndPost.mock.calls[0];
    expect(jeClient).toBe(h.tx);
    expect(jeInput.metadata).toMatchObject({
      tag: 'JP4',
      flow: 'early-payoff',
      source: 'PAYSOLUTIONS_GATEWAY',
      gatewayRefno: '793700000041',
      gatewayTransactionId: 'TX-41',
      paymentLinkId: 'track-41',
    });
    expect(jeInput.lines.find((l: { accountCode: string }) => l.accountCode === '11-1202')).toBeDefined();
    const audit = h.auditRows.find((r) => r.action === 'EARLY_PAYOFF_GATEWAY_MATCHED');
    expect(audit).toMatchObject({ entity: 'contract', entityId: 'contract-ep-park-1', userId: 'owner-1' });
    expect(audit!.newValue).toMatchObject({
      totalPayoff: '11106.00',
      paidAmount: '11106.00',
      refno: '793700000041',
      transactionId: 'TX-41',
      paymentLinkId: 'track-41',
      quotedTotalPayoff: '11106.00',
      quoteDate: '2026-11-03',
    });
    const paymentUpdate = h.tx.payment.update.mock.calls[0][0].data;
    expect(paymentUpdate).toMatchObject({
      status: 'PAID',
      paymentMethod: 'ONLINE_GATEWAY',
      gatewayRef: '793700000041',
      gatewayStatus: 'SUCCESS',
      gatewayResponse: g.webhookData,
      notes: '[ปิดก่อนกำหนด] ชำระผ่าน Pay Solutions (TX-41)',
    });
    expect(h.contractUpdates.some((d) => d.status === 'EARLY_PAYOFF')).toBe(true);
  });

  it('ใบ EARLY_PAYOFF / journey ไม่เกิดก่อน webhook commit — เกิดเมื่อ webhook เรียกงานหลัง commit · journey ผู้กระทำ = ลูกค้า', async () => {
    const h = build('0');
    const g = gateway(h);

    await h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, g);

    expect(h.receipts.generateReceipt).not.toHaveBeenCalled();
    expect(h.journey.recordAfterCommit).not.toHaveBeenCalled();
    expect(g.work).toHaveLength(1);

    await g.work[0]();

    expect(h.receipts.generateReceipt).toHaveBeenCalledWith(
      'contract-ep-park-1',
      null,
      'EARLY_PAYOFF',
      11106,
      null,
      'ONLINE_GATEWAY',
      'TX-41',
      'owner-1',
      new Date('2026-11-03T05:00:00.000Z'),
      'JE-EP-PARK-0001',
    );
    expect(h.journey.recordAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'EARLY_PAYOFF',
        actorType: 'CUSTOMER',
        actorUserId: null,
        data: expect.objectContaining({ receiptNumber: 'RT-202611-00001', totalPayoff: 11106 }),
      }),
    );
  });

  it('ใบ EARLY_PAYOFF ออกไม่สำเร็จหลัง commit → Sentry error พร้อมอาร์กิวเมนต์ออกใบซ้ำ (path paysolutions-webhook-payoff) · ไม่ throw', async () => {
    const h = build('0');
    h.receipts.generateReceipt.mockRejectedValue(new Error('receipt down'));
    const g = gateway(h);
    await h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, g);

    await expect(g.work[0]()).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ action: 'post-commit-receipt-failed', path: 'paysolutions-webhook-payoff' }),
        extra: expect.objectContaining({
          journalEntryNumber: 'JE-EP-PARK-0001',
          amount: '11106.00',
          transactionRef: 'TX-41',
          issuedById: 'owner-1',
        }),
      }),
    );
  });

  it('ยอดปิดสดไม่ตรงเงินที่รับ (เกิน 0.01) → GatewayPayoffMismatchError พร้อมยอดปิดสด · ไม่ลง JE ไม่เขียน audit', async () => {
    const h = build('0');
    const attempt = h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, gateway(h, '11000.00'));

    await expect(attempt).rejects.toBeInstanceOf(GatewayPayoffMismatchError);
    await expect(attempt).rejects.toMatchObject({ liveTotalPayoff: 11106, paidAmount: '11000.00' });
    expect(h.createAndPost).not.toHaveBeenCalled();
    expect(h.auditRows).toHaveLength(0);
  });

  it('ต่าง 0.01 ยังผ่าน (กติกาเดียวกับสลิปตรง — รายการลงยอดปิด)', async () => {
    const h = build('0');
    const res = await h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, gateway(h, '11106.01'));
    expect(res.status).toBe('EARLY_PAYOFF');
    expect(res.totalPayoff).toBe(11106);
  });

  it('gatewayMatch มาพร้อมทางเข้าอื่น → 403 ไม่ลงอะไร', async () => {
    const h = build('0');
    await expect(
      h.service.earlyPayoff(
        'contract-ep-park-1',
        'owner-1',
        dto,
        undefined,
        { imageKey: 'k', hash: 'h', amount: 11106, refNo: null, bankName: null, date: null, confidence: 1 },
        gateway(h),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.createAndPost).not.toHaveBeenCalled();
  });

  it('คำขอคืนเงินรอธนาคาร (#24) → 400 จากด่านเดิมในธุรกรรม (webhook ถอยเป็น FIFO)', async () => {
    const h = build('0');
    h.tx.refund.findMany.mockResolvedValue([{ id: 'rf-1', amount: dec('500'), payment: { installmentNo: 7 } }]);

    await expect(
      h.service.earlyPayoff('contract-ep-park-1', 'owner-1', dto, undefined, undefined, gateway(h)),
    ).rejects.toThrow(/คำขอคืนเงินที่อนุมัติแล้ว/);
    expect(h.createAndPost).not.toHaveBeenCalled();
  });
});
