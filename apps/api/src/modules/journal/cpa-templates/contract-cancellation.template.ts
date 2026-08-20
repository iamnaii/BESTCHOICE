import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeCancelReversalTemplate } from './exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { glContractBalance } from '../gl-contract-balance';

/**
 * Template — Contract Cancellation C-1 (Phase 3, workbook 2026-08-19 spec §6).
 *
 * Reworked from the P4-SP4 mirror-1A-only version: instead of hand-mirroring
 * the single 1A activation JE, it delegates to the generalized cancel-sweep
 * engine (`ExchangeCancelReversalTemplate.reverse`) which mirror-reverses
 * EVERY POSTED JE tagged `metadata.contractId` — 1A, SHOP legs
 * (inventory-transfer COGS + revenue/receivable), 2A accruals, etc. — carrying
 * companyId + metadata.contractId so every account nets to 0 per contract.
 *
 * ECL is handled OUTSIDE the sweep (excludeFlows) with a single release JE:
 * mirroring the provision JE AND posting a release would double-debit 11-2102
 * (negative balance). Instead the live GL balance of 11-2102 is released in
 * one `EclStageReverseTemplate` JE (pattern JP4 C1 — release from live GL),
 * and the ACTIVE `BadDebtProvision` rows are flipped to REVERSED.
 *
 * REAL-CASH flows are excluded too (Fix Round 1 — a mirror of a cash JE
 * fabricates cash movement that never happened):
 *   - 'shop-collect-settlement' (Dr cash / Cr 11-2107) — the service guard
 *     rejects cancellation while any SHOP_COLLECT balance is outstanding.
 *   - 'shop-down-payment' (Dr SHOP cash / Cr S21-2001) — the down JE is NOT
 *     mirrored: after cancellation S21-2001 deliberately stays Cr downAmount
 *     (เจ้าหนี้เงินดาวน์รอคืนลูกค้า) until SHOP actually refunds the cash
 *     (ShopDownPaymentReversalTemplate pre-activation; JV post-activation
 *     until a dedicated UI exists).
 *   - 'reschedule-collect' (Dr cash / Cr 21-1103 + 42-1103) — 6a fee money
 *     really entered the till; the service's park-balance guard blocks
 *     cancellation while any advance/credit/park balance remains.
 * On top of the deny-list, a POSITIVE tripwire scans every sweep candidate
 * BEFORE reversing: any candidate line touching a cash/bank account (prefix
 * 11-11 / 11-12 / S11-11 / S11-12) → loud BadRequestException naming the
 * entryNumber — an unknown cash JE must never be silently mirror-reversed.
 *
 * The refund JE block (Dr 52-1106 / Cr 11-1201) was DELETED (Phase 3): the
 * customer's down payment lives on the SHOP book as the S21-2001 payable
 * described above. The service guard rejects refundAmount > 0.
 *
 * Idempotency (DB-backed, Phase 3 decision): probes
 * `ContractCancellation.reversalJournalEntryId` — the FK the approve flow has
 * always persisted in the same $transaction as the JEs. The old metadata
 * probe (flow='contract-cancellation' + cancellationId) could not see the new
 * sweep-produced reversals (they stamp per-JE idempotencyKey
 * `contract-cancellation:<jeId>`, no cancellationId), while the FK covers
 * both the legacy P4-SP4 JEs and the new sweep output. The sweep engine's own
 * per-JE `reversed:true` stamp + DB idempotency index remain the second
 * layer.
 */
/**
 * Flows the C-1 sweep must NEVER mirror — ECL (released separately) + flows
 * whose JEs move REAL cash (mirror = fabricated cash movement). Shared by the
 * sweep call AND the cash tripwire below so the two can never drift.
 */
const C1_EXCLUDED_FLOWS = [
  'provision',
  'stage-reverse',
  'shop-collect-settlement',
  'shop-down-payment',
  'reschedule-collect',
];

/** Cash/bank account prefixes (FINANCE 11-11xx/11-12xx + SHOP S11-11xx/S11-12xx). */
const CASH_ACCOUNT_PREFIXES = ['11-11', '11-12', 'S11-11', 'S11-12'];

@Injectable()
export class ContractCancellationTemplate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sweepTemplate: ExchangeCancelReversalTemplate,
    private readonly eclStageReverse: EclStageReverseTemplate,
  ) {}

  async execute(
    params: {
      contractId: string;
      cancellationId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNumber: string; reversalJeIds: string[] }> {
    const { contractId, cancellationId } = params;
    const client = tx ?? this.prisma;

    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNumber: true },
    });

    // Idempotency (DB-backed): the approve flow persists the first reversal
    // JE id onto the cancellation row inside the same $transaction — if it is
    // already set, the reversal chain was fully posted before.
    const cancellationRow = await client.contractCancellation.findUnique({
      where: { id: cancellationId },
      select: { reversalJournalEntryId: true },
    });
    if (cancellationRow?.reversalJournalEntryId) {
      const existing = await client.journalEntry.findUniqueOrThrow({
        where: { id: cancellationRow.reversalJournalEntryId },
        select: { entryNumber: true },
      });
      return { entryNumber: existing.entryNumber, reversalJeIds: [] };
    }

    // Guard (kept from P4-SP4): a contract with no 1A activation JE has
    // nothing on the books to cancel — reject instead of a silent no-op sweep.
    const activationJe = await (client.journalEntry as Prisma.JournalEntryDelegate).findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: '1A' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
        ],
        status: 'POSTED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!activationJe) {
      throw new BadRequestException(
        `ไม่พบรายการบัญชีเปิดสัญญา (1A) สำหรับสัญญา ${contract.contractNumber} — ไม่สามารถยกเลิกได้`,
      );
    }

    // Positive tripwire (Fix Round 1 — Important #4): scan the EXACT sweep
    // candidate set (same conditions the engine applies) BEFORE reversing.
    // Any candidate touching a cash/bank account = an unknown cash JE the
    // deny-list doesn't know about → reject loudly instead of silently
    // fabricating a cash reversal.
    const candidates = await (client.journalEntry as Prisma.JournalEntryDelegate).findMany({
      where: {
        metadata: { path: ['contractId'], equals: contractId } as never,
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });
    for (const je of candidates) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;
      if (meta['reversed'] === true) continue;
      if (meta['flow'] === 'contract-cancellation') continue;
      if (C1_EXCLUDED_FLOWS.includes(meta['flow'] as string)) continue;
      if (meta['tag'] === 'REVERSAL') continue;
      const cashLine = je.lines.find((l) =>
        CASH_ACCOUNT_PREFIXES.some((p) => l.accountCode.startsWith(p)),
      );
      if (cashLine) {
        throw new BadRequestException(
          `ใบสำคัญ ${je.entryNumber} ของสัญญา ${contract.contractNumber} มีบรรทัดแตะบัญชีเงินสด/ธนาคาร (${cashLine.accountCode}) — ` +
            'ระบบไม่กลับรายการเงินสดอัตโนมัติ กรุณาตรวจสอบ/กลับรายการใบนี้ด้วยมือก่อนยกเลิกสัญญา',
        );
      }
    }

    // C-1: sweep-reverse ทุก JE ของสัญญา ยกเว้น ECL flows (release แยกใบเดียว —
    // exclude กัน double: sweep mirror + release พร้อมกันจะทำ 11-2102 ติดลบ)
    // และ flows เงินสดจริง (shop-collect / down / reschedule-collect — ดู
    // C1_EXCLUDED_FLOWS + doc comment ด้านบน)
    const { reversalJeIds } = await this.sweepTemplate.reverse(
      {
        jeIds: [],
        newContractId: contractId, // ชื่อ param เดิมของ engine — คือ contractId ที่ sweep
        excludeFlows: C1_EXCLUDED_FLOWS,
        flowLabel: 'contract-cancellation',
        descriptionPrefix: '[ยกเลิกสัญญา]',
      },
      tx,
    );
    if (reversalJeIds.length === 0) {
      throw new BadRequestException(
        `ไม่มีรายการบัญชีให้กลับรายการสำหรับสัญญา ${contract.contractNumber} — รายการอาจถูกกลับไปก่อนหน้านี้แล้ว`,
      );
    }

    // ECL: release ใบเดียวจาก live GL (pattern JP4 C1) + flip provision rows
    const eclBal = await glContractBalance(client, contractId, '11-2102', 'cr');
    if (eclBal.greaterThan(0)) {
      await this.eclStageReverse.execute(
        { contractId, reverseAmount: eclBal, fromBucket: 'CANCEL', toBucket: 'CANCEL' },
        tx,
      );
    }
    await client.badDebtProvision.updateMany({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      data: { status: 'REVERSED' },
    });

    const firstJe = await client.journalEntry.findUniqueOrThrow({
      where: { id: reversalJeIds[0] },
      select: { entryNumber: true },
    });
    return { entryNumber: firstJe.entryNumber, reversalJeIds };
  }
}
