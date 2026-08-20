import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeCancelReversalTemplate, SweepRedirect } from './exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { glContractBalance } from '../gl-contract-balance';

/**
 * Template — Contract Cancellation C-1 + C-2 (Phase 3, workbook 2026-08-19 spec §6).
 *
 * C-2 (Task 3 — ยกเลิกหลังตัดจ่ายรอบจ่าย INTER-CO แล้ว, workbook Case 3A กรณี 2):
 * the service detects `Σ(financedGl+commissionGl)` over the contract's
 * SETTLEMENT items in POSTED batches and passes `{ isC2, settledTotal }`. The
 * sweep then REDIRECTS the mirror legs of 21-1101/21-1102 → 11-2107 and
 * S11-3001/S11-3002 → S21-3001 (stamp `shopReceivableType: 'PAYOUT_RECALL'` on
 * JEs carrying a redirect leg) instead of mirroring straight back — the batch
 * already cleared those accounts, a straight mirror would drive them negative.
 * After the sweep, `redirectedTotals['11-2107']` is cross-checked against
 * `settledTotal` (±0.01) — a mismatch (hand-JV on a lens account outside the
 * batch) throws inside the tx so the whole sweep rolls back. Task 4 fold adds
 * the SHOP-book twin: `redirectedTotals['S21-3001']` (Cr legs ⇒ negated)
 * against `settledShopTotal` — a SHOP-only hand-JV passes the FINANCE check
 * untouched, so each book must be verified independently.
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

/**
 * C-2 (Phase 3 Task 3 — workbook Case 3A กรณี 2): เจ้าหนี้/ลูกหนี้รอบจ่ายที่ถูก
 * ตัดจ่ายผ่าน batch POSTED ไปแล้ว mirror ตรงกลับบัญชีเดิมไม่ได้ (จะติดลบ) —
 * redirect เป็นลูกหนี้เรียกคืน 11-2107 [PAYOUT_RECALL] / เจ้าหนี้ S21-3001 แทน.
 *
 * Exported (Phase 3 Task 5): เส้นทาง exchange-cancel (`ExchangeCancelService`)
 * ใช้ redirect map/stamp ชุดเดียวกันเมื่อ swap ถูกยกเลิกหลังรอบจ่าย POSTED —
 * ห้ามมีสำเนาที่สอง (drift ระหว่างสองเส้นทาง = คิว recall สองสมุดเพี้ยน).
 */
export const C2_REDIRECTS: Record<string, SweepRedirect> = {
  '21-1101': { to: '11-2107', description: 'ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ยอดจัดที่ตัดจ่ายแล้ว)' },
  '21-1102': { to: '11-2107', description: 'ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ค่าคอมที่ตัดจ่ายแล้ว)' },
  'S11-3001': { to: 'S21-3001', description: 'ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ยอดจัด)' },
  'S11-3002': { to: 'S21-3001', description: 'ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ค่าคอม)' },
};
export const C2_REDIRECT_SOURCES = Object.keys(C2_REDIRECTS);

/** Stamp บน reversal JE ที่มี redirect leg — ใช้ร่วมกันทั้ง generic + exchange path */
export const C2_REDIRECT_STAMP: Record<string, string> = {
  shopReceivableType: 'PAYOUT_RECALL',
};

/**
 * บัญชี typed lens (Phase 2 หักกลบ). Defensive check (C-2 path เท่านั้น): JE ใด
 * มีทั้งบรรทัดบน redirect source (21-1101/21-1102/S11-3001/S11-3002) และบรรทัด
 * บนบัญชี typed (หรือ metadata.shopReceivableType เดิม) ในใบเดียวกัน — redirect
 * stamp `PAYOUT_RECALL` ทั้งใบจะทับความหมาย typed เดิมของบรรทัดนั้น (เลนส์ Phase 2
 * อ่าน type จาก metadata ระดับ JE) → hand-JV ผิดปกติ producer จริงไม่มีทางสร้าง
 * ต้อง reject ดังๆ แทนที่จะ stamp ทับเงียบๆ. (Exported — Task 5: exchange path
 * ทำ defensive check ชุดเดียวกัน.)
 */
export const TYPED_LENS_ACCOUNTS = ['11-2107', 'S21-3001'];

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
      /** C-2 (Phase 3 Task 3): สัญญาถูกตัดจ่ายผ่าน batch POSTED แล้ว → redirect */
      isC2?: boolean;
      /** Σ financedGl + commissionGl จาก item SETTLEMENT ใน batch POSTED (service คำนวณใน tx) */
      settledTotal?: Decimal;
      /** Σ shopFinancedGl + shopCommissionGl จาก item SETTLEMENT เดียวกัน — cross-check ฝั่ง SHOP (Task 4 fold) */
      settledShopTotal?: Decimal;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNumber: string; reversalJeIds: string[] }> {
    const { contractId, cancellationId, isC2 } = params;
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
      // Defensive check (C-2 path เท่านั้น — Task 3): JE ที่มีทั้งบรรทัด redirect
      // source และบรรทัดบัญชี typed (11-2107/S21-3001) หรือ shopReceivableType
      // เดิมอยู่แล้ว — redirect stamp PAYOUT_RECALL ทั้งใบจะทับความหมาย typed
      // เดิม (เลนส์อ่าน type ระดับ JE) → hand-JV ผิดปกติ reject ก่อน sweep เริ่ม.
      if (isC2) {
        const redirectSourceLine = je.lines.find((l) =>
          C2_REDIRECT_SOURCES.includes(l.accountCode),
        );
        const typedLine = je.lines.find((l) => TYPED_LENS_ACCOUNTS.includes(l.accountCode));
        const hasTypedStamp = typeof meta['shopReceivableType'] === 'string';
        if (redirectSourceLine && (typedLine || hasTypedStamp)) {
          throw new BadRequestException(
            `ใบสำคัญ ${je.entryNumber} ของสัญญา ${contract.contractNumber} มีทั้งบรรทัดเจ้าหนี้/ลูกหนี้รอบจ่าย (${redirectSourceLine.accountCode}) ` +
              'และบรรทัด/ประเภทบัญชีลูกหนี้เรียกคืน (11-2107/S21-3001) ในใบเดียวกัน — ' +
              'ระบบ redirect เป็น PAYOUT_RECALL ให้ไม่ได้ (จะทับความหมายประเภทเดิม) กรุณาตรวจสอบ/กลับรายการใบนี้ด้วยมือก่อนยกเลิกสัญญา',
          );
        }
      }
    }

    // C-1: sweep-reverse ทุก JE ของสัญญา ยกเว้น ECL flows (release แยกใบเดียว —
    // exclude กัน double: sweep mirror + release พร้อมกันจะทำ 11-2102 ติดลบ)
    // และ flows เงินสดจริง (shop-collect / down / reschedule-collect — ดู
    // C1_EXCLUDED_FLOWS + doc comment ด้านบน)
    const { reversalJeIds, redirectedTotals } = await this.sweepTemplate.reverse(
      {
        jeIds: [],
        newContractId: contractId, // ชื่อ param เดิมของ engine — คือ contractId ที่ sweep
        excludeFlows: C1_EXCLUDED_FLOWS,
        flowLabel: 'contract-cancellation',
        descriptionPrefix: '[ยกเลิกสัญญา]',
        // C-2 เท่านั้น: redirect เจ้าหนี้/ลูกหนี้รอบจ่ายที่ตัดจ่ายแล้ว → ลูกหนี้
        // เรียกคืน [PAYOUT_RECALL] (C-1 ห้ามมี key พวกนี้เลย — unit spec ปักไว้)
        ...(isC2
          ? {
              redirects: C2_REDIRECTS,
              redirectStamp: C2_REDIRECT_STAMP,
            }
          : {}),
      },
      tx,
    );
    if (reversalJeIds.length === 0) {
      throw new BadRequestException(
        `ไม่มีรายการบัญชีให้กลับรายการสำหรับสัญญา ${contract.contractNumber} — รายการอาจถูกกลับไปก่อนหน้านี้แล้ว`,
      );
    }

    // Cross-check (C-2 — carry (a) + กัน hand-JV): ยอดที่ redirect เข้า 11-2107
    // ต้องเท่ากับ Σ settled จาก item SETTLEMENT ใน batch POSTED (±0.01). ไม่ตรง
    // = มี JE แตะเจ้าหนี้รอบจ่ายนอกเหนือจากที่ batch ตัดจ่าย → throw ใน tx
    // ให้ sweep ทั้งชุด rollback (ห้ามยกเลิกบนตัวเลขที่เพี้ยน).
    if (isC2) {
      const redirected = redirectedTotals['11-2107'] ?? new Decimal(0);
      const settled = params.settledTotal ?? new Decimal(0);
      if (redirected.minus(settled).abs().gt('0.01')) {
        throw new BadRequestException(
          `ยอดเรียกคืน (${redirected.toFixed(2)}) ไม่ตรงกับยอดที่ตัดจ่ายใน batch POSTED (${settled.toFixed(2)}) — มีรายการเดินบัญชีผิดปกติ ตรวจสอบก่อนยกเลิก`,
        );
      }
      // Cross-check ฝั่ง SHOP (Task 4 fold): hand-JV ที่แตะเฉพาะ S11-3001/
      // S11-3002 ผ่านเช็ค 11-2107 ด้านบนได้ (สมุด FINANCE ไม่กระเทือน) แต่จะ
      // ทำให้เจ้าหนี้เรียกคืนฝั่งร้าน (S21-3001 [PAYOUT_RECALL]) ไม่เท่ากับ
      // ฝั่ง FINANCE → คิว recall สองสมุดเพี้ยนถาวร — ต้องเช็คแยกสมุด.
      // redirect ฝั่ง SHOP เป็นขา **Cr** ⇒ `redirectedTotals` (Σ Dr−Cr) ติดลบ;
      // ยอดเจ้าหนี้เรียกคืนที่ตั้งจริง = .neg(). เทียบกับ Σ(shopFinancedGl +
      // shopCommissionGl) ของ item SETTLEMENT ใน batch POSTED — ค่านี้ survive
      // legacyNoShop โดยโครงสร้าง: สัญญา legacy snapshot ฝั่ง SHOP = 0 →
      // expected 0 และไม่มี SHOP JE ให้ redirect อยู่แล้ว → 0 = 0 ✓.
      const redirectedShop = (redirectedTotals['S21-3001'] ?? new Decimal(0)).neg();
      const settledShop = params.settledShopTotal ?? new Decimal(0);
      if (redirectedShop.minus(settledShop).abs().gt('0.01')) {
        throw new BadRequestException(
          `ยอดเรียกคืนฝั่งร้าน (${redirectedShop.toFixed(2)}) ไม่ตรงกับยอดที่ตัดจ่ายฝั่งร้านใน batch POSTED (${settledShop.toFixed(2)}) — มีรายการเดินบัญชีผิดปกติ ตรวจสอบก่อนยกเลิก`,
        );
      }
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
