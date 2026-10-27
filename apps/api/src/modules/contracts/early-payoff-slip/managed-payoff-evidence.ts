import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canAccess } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertEvidenceImage,
  EVIDENCE_IMAGE_MAX_BYTES,
  evidenceImageExtension,
} from '../../../utils/upload-image.util';
import { bangkokDateString } from '../../../utils/date.util';
import { currentDomainAccess } from '../../employee-access/access-execution-context';
import { procurementPreparation } from '../../employee-access/access-preparation-context';
import { StorageService } from '../../storage/storage.service';
import { VisionService } from '../../chatbot-finance/services/vision.service';
import { FinanceConfigService } from '../../chatbot-finance/services/finance-config.service';
import { approvalJson, canonical } from '../../payments/services/payment-approval-request.util';
import { createEarlyPayoffRequest } from '../../payments/services/early-payoff-request';
import { ContractPaymentService } from '../contract-payment.service';
import { managedPayoffExecution, ManagedPayoffExecution } from '../managed-payoff-execution';
import { evaluateSlipChecks, SlipReading, slipFingerprint, slipPaymentDate } from './slip-checks';
import { EarlyPayoffSlipConfirmDto } from '../dto/early-payoff-slip.dto';

const logger = new Logger('ManagedPayoffEvidence');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const invalid = () => new BadRequestException('หลักฐานปิดสัญญาไม่ถูกต้อง กรุณาตรวจสลิปใหม่');
const changed = () => new ConflictException('หลักฐานหรือยอดปิดเปลี่ยนแล้ว กรุณาตรวจสลิปใหม่');
function retention(reason: string) {
  try {
    logger.warn({ event: 'PAYOFF_EVIDENCE_CLEANUP_RETAINED', reason });
  } catch {
    /* Keep primary failure. */
  }
}
const BANK = '11-1201';
const TTL = 15 * 60 * 1000;

export async function authorizePayoffEvidence(prisma: PrismaService, id: string, actor: string) {
  const source = await managedPayoffExecution(prisma, id, actor);
  const ctx = currentDomainAccess();
  if (
    !source ||
    !ctx ||
    !canAccess(ctx.snapshot, 'documents.create', {
      company: 'FINANCE',
      branchId: source.originBranchId,
    })
  )
    throw new ForbiddenException('ไม่มีสิทธิ์แนบหลักฐานปิดสัญญานี้');
  return source;
}
function provenance(source: ManagedPayoffExecution, contractId: string) {
  return {
    actorId: source.actorId,
    contractId,
    financeCompanyId: source.financeCompanyId,
    originShopCompanyId: source.originShopCompanyId,
    originBranchId: source.originBranchId,
  };
}
function effectiveRate(raw: string | number | undefined) {
  if (raw === undefined) return 50;
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    (typeof raw === 'string' && !raw.trim())
  )
    throw invalid();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw invalid();
  return Math.min(50, n);
}
/** Only finite bounded OCR fields are retained; arbitrary provider payload/error text is discarded. */
function normalizeReading(input: unknown): SlipReading | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof r[key] === 'string' && (r[key] as string).length <= max
      ? (r[key] as string).trim()
      : null;
  const date = text('date', 10),
    time = text('time', 5);
  return {
    isSlip: r.isSlip === true,
    confidence:
      typeof r.confidence === 'number' &&
      Number.isFinite(r.confidence) &&
      r.confidence >= 0 &&
      r.confidence <= 1
        ? r.confidence
        : 0,
    amount:
      typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0 && r.amount <= 1e12
        ? r.amount
        : null,
    refNo: text('refNo', 200),
    bankName: text('bankName', 100),
    toAccount: text('toAccount', 100),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
  };
}
/** R142: customer money/allocation inputs only. Ledger/ECL/receipt state is freshly
 * validated by the canonical executor; a legitimate 2A posting need not stale a ticket. */
async function moneySnapshot(
  source: ManagedPayoffExecution,
  contractId: string,
  paymentDate: string,
  rate: number,
  payment: ContractPaymentService,
) {
  const tx = source.client;
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: {
      id: true,
      customerId: true,
      productId: true,
      status: true,
      totalMonths: true,
      monthlyPayment: true,
      creditBalance: true,
      rescheduleAdvanceBalance: true,
      advanceBalance: true,
      vatPct: true,
      sellingPrice: true,
      downPayment: true,
      storeCommission: true,
      financedAmount: true,
      interestTotal: true,
      vatAmount: true,
    },
  });
  const payments = await tx.payment.findMany({
    where: { contractId, deletedAt: null },
    orderBy: [{ installmentNo: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      installmentNo: true,
      status: true,
      amountDue: true,
      amountPaid: true,
      monthlyPrincipal: true,
      monthlyInterest: true,
      monthlyCommission: true,
      vatAmount: true,
      lateFee: true,
      lateFeeWaived: true,
      dueDate: true,
    },
  });
  const schedules = await tx.installmentSchedule.findMany({
    where: { contractId, deletedAt: null },
    orderBy: [{ installmentNo: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      installmentNo: true,
      dueDate: true,
      principal: true,
      interest: true,
      amountDue: true,
    },
  });
  const { journalPreview: ignoredPreview, ...quote } = await payment.getEarlyPayoffQuote(
    contractId,
    rate,
    BANK,
    tx,
    { skipJournalPreview: true },
  );
  void ignoredPreview; // The internal journal preview is deliberately excluded.
  const snapshot = approvalJson({
    version: 1,
    ...provenance(source, contractId),
    paymentMethod: 'BANK_TRANSFER',
    depositAccountCode: BANK,
    effectiveDiscountPct: rate,
    paymentDate,
    contract,
    payments,
    schedules,
    quote,
  });
  return { snapshot, fingerprint: hash(canonical(snapshot)), quote };
}
export class ManagedPayoffEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly vision: VisionService,
    private readonly financeConfig: FinanceConfigService,
    private readonly payment: ContractPaymentService,
  ) {}

  async verify(
    id: string,
    actor: string,
    file: Express.Multer.File | undefined,
    rawRate: string | number | undefined,
    reason?: string,
  ) {
    const preparation = procurementPreparation.getStore();
    if (preparation?.source !== 'payoff-slip' || !preparation.authorize || currentDomainAccess())
      throw invalid();
    const rate = effectiveRate(rawRate);
    if (
      (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) ||
      (rate > 0 && !reason?.trim())
    )
      throw new BadRequestException('กรุณาระบุเหตุผลที่ขออนุมัติไม่เกิน 1000 ตัวอักษร');
    assertEvidenceImage(file, 'สลิปปิดสัญญา');
    if (!file.buffer.length || file.buffer.length > EVIDENCE_IMAGE_MAX_BYTES) throw invalid();
    await preparation.authorize();
    const operationId = randomUUID(),
      evidenceId = randomUUID();
    const objectKey = `managed-payoff-slips/${id}/${operationId}.${evidenceImageExtension(file.mimetype)}`;
    const contentHash = hash(file.buffer);
    try {
      await this.storage.uploadOwned(objectKey, file.buffer, file.mimetype, operationId);
      let raw: unknown = null;
      try {
        raw = await this.vision.extractSlip(file.buffer, file.mimetype);
      } catch {
        /* Honest unverified evidence; no provider strings. */
      }
      const reading = normalizeReading(raw);
      const now = new Date(),
        paymentDate = bangkokDateString(slipPaymentDate(reading, now));
      // Generated once outside retry. No raw token is persisted or sent to audit.
      const token = randomBytes(32).toString('base64url');
      return await preparation.execute(async () => {
        const source = await authorizePayoffEvidence(this.prisma, id, actor),
          tx = source.client;
        const money = await moneySnapshot(source, id, paymentDate, rate, this.payment);
        const legacyHash = reading ? slipFingerprint(reading, objectKey) : null;
        const reused =
          !!(await tx.managedPayoffEvidence.findFirst({
            where: { contentHash, consumedAt: { not: null } },
            select: { id: true },
          })) ||
          !!(
            legacyHash &&
            (await tx.slipFingerprint.findUnique({
              where: { hash: legacyHash },
              select: { id: true },
            }))
          );
        const checks = evaluateSlipChecks({
          reading,
          expectedAmount: money.quote.totalPayoff,
          reused,
          now,
          isCompanyAccount: (account) => this.financeConfig.isCompanyBankAccount(account),
        }).map(({ code, ok, label }) => ({ code, ok, label }));
        const matched = checks.every((c) => c.ok),
          executable = rate === 0 && matched;
        await tx.managedPayoffEvidence.create({
          data: {
            id: evidenceId,
            operationId,
            ...provenance(source, id),
            objectKey,
            mimeType: file.mimetype,
            byteLength: file.buffer.length,
            contentHash,
            reading: reading ? approvalJson(reading) : Prisma.JsonNull,
            checks: approvalJson(checks),
            verified: matched,
            effectiveDiscountPct: String(rate),
            paymentDate,
            moneySnapshot: money.snapshot,
            moneyFingerprint: money.fingerprint,
            slipFingerprint: legacyHash,
            tokenHash: executable ? hash(token) : null,
            expiresAt: executable ? new Date(now.getTime() + TTL) : null,
          },
        });
        if (rate > 0) {
          const request = await createEarlyPayoffRequest(tx, this.payment, {
            targetId: id,
            userId: actor,
            reason: reason!,
            payload: {
              paymentMethod: 'BANK_TRANSFER',
              discountPct: rate,
              depositAccountCode: BANK,
              paymentDate,
            },
            managedSource: {
              version: 1,
              requesterId: actor,
              contractId: id,
              financeCompanyId: source.financeCompanyId,
              originShopCompanyId: source.originShopCompanyId,
              originBranchId: source.originBranchId,
            },
            managedEvidenceId: evidenceId,
          });
          return { requestId: request.id, status: 'PENDING_APPROVAL' as const };
        }
        await tx.auditLog.create({
          data: {
            userId: actor,
            entity: 'contract',
            entityId: id,
            action: 'EARLY_PAYOFF_EVIDENCE_RECORDED',
            newValue: { evidenceId, status: 'RECORDED' },
          },
        });
        return {
          engine: 'OCR' as const,
          available: reading !== null,
          expectedAmount: money.quote.totalPayoff,
          discountPct: 0,
          checks,
          matched,
          paymentDate,
          ticket: executable ? token : null,
        };
      });
    } catch (error) {
      try {
        const outcome = await this.storage.deleteOwned(objectKey, operationId);
        if (outcome.status === 'retained') retention(outcome.reason);
      } catch {
        retention('cleanup-failed');
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('ไม่สามารถบันทึกหลักฐานปิดสัญญาได้');
    }
  }

  async confirm(id: string, actor: string, dto: EarlyPayoffSlipConfirmDto) {
    const source = await authorizePayoffEvidence(this.prisma, id, actor),
      tx = source.client;
    if (typeof dto.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(dto.ticket)) throw invalid();
    const tokenHash = hash(dto.ticket);
    await tx.$queryRaw`SELECT id FROM managed_payoff_evidence WHERE token_hash=${tokenHash} FOR UPDATE`;
    const evidence = await tx.managedPayoffEvidence.findUnique({ where: { tokenHash } });
    if (
      !evidence ||
      Object.entries(provenance(source, id)).some(([key, value]) => evidence[key] !== value) ||
      evidence.effectiveDiscountPct !== '0' ||
      !evidence.verified ||
      evidence.requestId ||
      evidence.consumedAt ||
      !evidence.expiresAt ||
      evidence.expiresAt.getTime() < Date.now() ||
      !evidence.slipFingerprint
    )
      throw changed();
    const money = await moneySnapshot(source, id, evidence.paymentDate, 0, this.payment);
    if (money.fingerprint !== evidence.moneyFingerprint) throw changed();
    const reading = normalizeReading(evidence.reading);
    if (
      !reading ||
      typeof reading.amount !== 'number' ||
      !evaluateSlipChecks({
        reading,
        expectedAmount: money.quote.totalPayoff,
        reused: !!(await tx.managedPayoffEvidence.findFirst({
          where: { contentHash: evidence.contentHash, consumedAt: { not: null } },
        })),
        isCompanyAccount: (account) => this.financeConfig.isCompanyBankAccount(account),
      }).every((c) => c.ok)
    )
      throw changed();
    const result = await this.payment.earlyPayoff(
      id,
      actor,
      {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: 0,
        depositAccountCode: BANK,
        paymentDate: evidence.paymentDate,
        referenceNo: reading.refNo ?? undefined,
        notes: dto.notes,
      },
      undefined,
      {
        imageKey: evidence.objectKey,
        hash: evidence.slipFingerprint,
        amount: reading.amount,
        refNo: reading.refNo ?? null,
        bankName: reading.bankName ?? null,
        date: reading.date ?? null,
        confidence: reading.confidence,
      },
    );
    if (!result.receiptId || !result.receiptNumber) throw changed();
    try {
      await tx.managedPayoffEvidence.update({
        where: { id: evidence.id },
        data: { consumedAt: new Date(), receiptId: result.receiptId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw changed();
      throw error;
    }
    await tx.auditLog.create({
      data: {
        userId: actor,
        entity: 'contract',
        entityId: id,
        action: 'EARLY_PAYOFF_EVIDENCE_CONSUMED',
        newValue: { evidenceId: evidence.id, receiptId: result.receiptId, status: 'COMPLETED' },
      },
    });
    return {
      status: 'COMPLETED',
      receiptId: result.receiptId,
      receiptNumber: result.receiptNumber,
    };
  }
}
