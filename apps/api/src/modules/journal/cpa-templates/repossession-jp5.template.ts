import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeCnBreakdown } from '../compute-cn-breakdown';
import { glContractBalance } from '../gl-contract-balance';

export interface RepossessionInput {
  contractId: string;
  depositAccountCode: string;
  /** Fair market value of repossessed device (amount received from customer) */
  repossessionValue: Decimal;
  /**
   * Shop-collect (2026-07-08): the caller substituted depositAccountCode with
   * 11-2107 ลูกหนี้-หน้าร้าน — stamp metadata so audit reports can pair the JE
   * with its later shop-collect settlement (same convention as JP4).
   */
  collectedByShop?: boolean;
  /**
   * วันที่รับเงิน/ลงบัญชี — JE entryDate + entry-number month series. Omitted →
   * now. Caller must run validatePeriodOpen on this date BEFORE the tx (C9:
   * createAndPost does not re-validate).
   */
  postedAt?: Date;
  /** เงินคืนส่วนต่างลูกค้า — ตั้งหนี้ ณ วันยึด (คำสั่งเจ้าของ 2026-08-08 ข้อ 2) */
  customerRefund?: Decimal;
}

/**
 * Template JP5 — Repossession (Case 5).
 *
 * Spec §6.5 — close out remaining installments on device repossession.
 *
 * VAT Split (Wave 1 / Task 7) — ป.รัษฎากร ม.82/3 + ประกาศ 36/2536 ข้อ 3:
 *   Each installment's VAT triggers ความรับผิด only ONCE. JP5 must inspect
 *   InstallmentSchedule.accrualJournalEntryId per installment and split:
 *
 *   Accrued (2A already ran — receivable parked at 11-2103):
 *     Dr depositAccountCode           (cash leg, shared)
 *     Dr 21-2101 (credit note VAT)    pro-rated per accrued+unpaid installment [Wave 2 / Task 2]
 *     Cr 11-2103 ลูกหนี้ค้างชำระ         GL balance (2026-07-26 Task 5 — see below)
 *     (No 11-2105/11-2106/21-2102/41-1101 — already settled by 2A.
 *      Income (41-1101) NOT reversed — customer used the goods, income properly earned;
 *      uncollectable portion flows to 51-1102 bad debt loss below.)
 *
 * Credit Note for accrued VAT (Wave 2 / Task 2) — ป.รัษฎากร ม.82/5 + ประกาศ 36/2536 ข้อ 2(6):
 *   ตอนยึดเครื่อง ส่วน VAT ที่นำส่งไปแล้ว (settled at 21-2101 by 2A) ต้องออกใบลดหนี้
 *   (credit note) ภายใน 30 วัน → Dr 21-2101 reduces VAT liability.
 *   Net effect on JE balance: 51-1102 loss reduces by exactly the credit note amount
 *   (VAT recovered via credit note is NOT a loss — it offsets receivable derecognized).
 *
 *   Deferred (2A not run — receivable still at 11-2101/11-2105/11-2106):
 *     Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย  GL balance (11-2106, cr side)
 *     Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ      GL balance (21-2102, cr side)
 *       Cr 11-2101 ลูกหนี้ Gross              GL balance (11-2101, dr side)
 *       Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          GL balance (11-2105, dr side)
 *       Cr 21-2101 ภาษีขาย ภ.พ.30            GL balance (21-2102, cr side — same amount, mirrors write-off)
 *       Cr 41-1101 รายได้ดอกเบี้ย             GL balance (11-2106, cr side — same amount, mirrors write-off)
 *
 * GL-based legs (2026-07-26, Task 5 — ยก pattern จาก BadDebtWriteOffTemplate):
 *   Every clearing leg above reads the ACTUAL GL balance for this contract
 *   (via the shared `glContractBalance` helper) instead of re-deriving
 *   installmentTotal × count. This fixes two things the count-based formula
 *   got wrong:
 *     1. A partially-paid accrued installment (real 2B receipt already
 *        reduced 11-2103) was previously OVER-CREDITED — JP5 would re-clear
 *        the FULL installmentTotal even though part of it was already paid,
 *        leaving a stale balance on 11-2103 forever (backlog bug, fixed here).
 *     2. Count-based math assumed every un-accrued installment still owed
 *        its exact per-installment share, but 2A's final-period residual
 *        sweep (installment #totalMonths) hasn't happened yet for contracts
 *        repossessed early — the true GL balance already reflects the
 *        contract's nominal total (grossExclVat + vatTotal) exactly, with no
 *        rounding drift, whereas installmentExclVat × deferredCount can be
 *        off by a few satang.
 *
 * Loss / Gain (from the balance equation, not a separately re-derived formula):
 *   Every GL-based line above (cash leg + CN + accrued/deferred clearing legs)
 *   is summed; loss/gain is whatever is left to balance the JE:
 *     lossOrGain = ΣCr(lines so far) − ΣDr(lines so far)
 *   loss = lossOrGain   → Dr 51-1102 (when > 0, net of provision consume below)
 *   gain = -lossOrGain  → Cr 41-1102 (when lossOrGain < 0)
 *   (Credit note VAT is already part of ΣDr — recovered via Dr 21-2101, not a P&L loss)
 *
 * Bad Debt provision (11-2102) — consume THEN release residual (Task 5):
 *   provisionBalance = GL balance of 11-2102 for this contract
 *   consume = min(loss, provisionBalance)          → Dr 11-2102 (when loss > 0)
 *   release = provisionBalance − consume           → Dr 11-2102 / Cr 51-1103 (when > 0)
 *   Once a contract is repossessed there is no more receivable left to provide
 *   against, so 11-2102 for this contract always lands on exactly 0 after JP5
 *   — whether via consume (loss case), release (gain/exact-wash case), or both
 *   (loss case where provision EXCEEDS the loss).
 *
 * Legal basis for VAT credit note (accrued portion) — Wave 4 / Task 2:
 *   - ป.รัษฎากร ม.82/5: ผู้ขายต้องออกใบลดหนี้ภายใน 30 วันนับแต่เหตุการณ์ที่
 *     ทำให้ฐาน VAT ลด (เลิกสัญญา · ยึดเครื่อง · ลดหนี้)
 *   - ประกาศอธิบดีกรมสรรพากร เกี่ยวกับ VAT (ฉบับที่) 36/2536 ข้อ 2(6):
 *     การยกเลิกสัญญาผ่อนชำระ (รวมถึงการยึดสินค้าคืน) ถือเป็นเหตุที่ทำให้
 *     เกิดสิทธิออกใบลดหนี้ — VAT ที่นำส่งไปแล้ว (settled at 21-2101 by 2A)
 *     สามารถออกใบลดหนี้กลับได้.
 *   - Deferred portion (2A ยังไม่ run): VAT ยังอยู่ที่ 21-2102 (deferred) →
 *     ปิดบัญชีตรง ๆ ไม่ต้องออกใบลดหนี้เพราะยังไม่เกิดความรับผิด.
 */
/** UI-shaped dry-run of the JP5 JE — same shape as JP4's journalPreview. */
export interface RepossessionJePreview {
  lines: {
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    description: string;
  }[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

@Injectable()
export class RepossessionJP5Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Shared money-math — builds the JP5 lines WITHOUT posting. Used by BOTH
   * execute() (ledger posting) and previewJe() (UI dry-run) so the preview
   * shown before ยืนยันยึดคืน is byte-for-byte the JE that gets posted
   * (same pattern as computeEarlyPayoffJE for JP4).
   */
  private async buildJe(
    input: Omit<RepossessionInput, 'postedAt'>,
    client: Prisma.TransactionClient | PrismaService,
  ) {
    const c = await client.contract.findUniqueOrThrow({ where: { id: input.contractId } });

    // Determine unpaid installments via Payment table (no status field on InstallmentSchedule)
    const allInsts = await client.installmentSchedule.findMany({
      where: { contractId: c.id, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
    const paidPayments = await client.payment.findMany({
      // deletedAt:null — แถว PAID ที่ถูก soft-delete ไม่ใช่หลักฐานว่ารับเงินจริง
      // (convention เดียวกับ compute-cn-breakdown I1 fix)
      where: { contractId: c.id, status: 'PAID', deletedAt: null },
      select: { installmentNo: true },
    });
    const paidNos = new Set(paidPayments.map((p) => p.installmentNo));
    const unpaidInsts = allInsts.filter((i) => !paidNos.has(i.installmentNo));
    const unpaid = unpaidInsts.length;

    if (unpaid === 0) {
      // 400 (not a raw 500) — hit by contracts whose payment rows are absent
      // or already all PAID; the caller surfaces this message to the UI.
      throw new BadRequestException(
        'สัญญานี้ไม่มีงวดค้างชำระให้ล้าง — ไม่สามารถยึดคืนได้ (nothing to repossess)',
      );
    }

    // VAT split: ป.รัษฎากร ม.82/3 — VAT แต่ละงวดเกิดความรับผิดเพียง 1 ครั้ง.
    // Accrued installments (2A run) already credited 21-2101 / 11-2105 / 41-1101
    // and debited 11-2106 / 21-2102, parking the receivable at 11-2103.
    // Deferred installments still hold their balances at the original 1A locations.
    const accruedInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId !== null);
    const deferredInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId === null);

    // Wave 2 T2 — Credit note VAT for accrued installments (per ม.82/5)
    // Recovers settled VAT (21-2101) → reduces both VAT liability and loss recognition
    // CPA pro-rate ruling (2026-07-26, docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md):
    // a partially-paid accrued installment's CN VAT is pro-rated to its
    // outstanding balance instead of the full vatPerInst. computeCnBreakdown is
    // the single source of truth shared with BadDebtWriteOffTemplate and
    // CreditNoteDocumentService so the JE and the CN document never drift.
    // Installments here are already accrued-only (filtered above) — pass them
    // preloaded so the util skips its own installmentSchedule query; payments
    // are left for the util to query itself (this array lacks amountPaid).
    const cnBreakdown = await computeCnBreakdown(client, c, { installments: accruedInsts });
    const accruedCreditNoteVat = cnBreakdown.totalCnVat;

    // ---- GL balances (2026-07-26, Task 5) ----
    // Same "sweep to zero" pattern as BadDebtWriteOffTemplate — read the
    // ACTUAL ledger balance instead of re-deriving installmentTotal × count.
    // Closes a backlog bug (a real 2B receipt against an accrued installment
    // was previously ignored — JP5 re-cleared the FULL installmentTotal
    // regardless) and eliminates a rounding-residual drift the count-based
    // math carried whenever the final-period residual sweep in 2A hadn't run
    // yet. See BadDebtWriteOffTemplate for the identical shared helper.
    const glBal = (accountCode: string, side: 'dr' | 'cr'): Promise<Decimal> =>
      glContractBalance(client, c.id, accountCode, side);

    const bal2103 = await glBal('11-2103', 'dr'); // accrued receivable remaining
    const bal2101 = await glBal('11-2101', 'dr'); // deferred Gross (excl. VAT) remaining
    const bal2105 = await glBal('11-2105', 'dr'); // deferred VAT receivable remaining
    const bal21_2102 = await glBal('21-2102', 'cr'); // deferred VAT liability remaining
    const bal2106 = await glBal('11-2106', 'cr'); // unearned interest remaining

    const zero = new Decimal(0);

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [
      {
        accountCode: input.depositAccountCode,
        dr: input.repossessionValue,
        cr: zero,
        description: `ราคากลางเครื่อง ${input.repossessionValue.toFixed(2)} ฿`,
      },
    ];

    // Credit note (ม.82/5) — keyed off the actual pro-rated amount (not
    // accruedInsts.length) so a fully-paid-but-still-accrued edge case never
    // claims a CN it doesn't owe (matches BadDebtWriteOffTemplate).
    if (accruedCreditNoteVat.gt(0)) {
      lines.push({
        accountCode: '21-2101',
        dr: accruedCreditNoteVat,
        cr: zero,
        description: `ใบลดหนี้ VAT ${cnBreakdown.count} งวด (ม.82/5)`,
      });
    }
    if (bal2106.gt(0)) {
      lines.push({
        accountCode: '11-2106',
        dr: bal2106,
        cr: zero,
        description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
      });
    }
    if (bal21_2102.gt(0)) {
      lines.push({
        accountCode: '21-2102',
        dr: bal21_2102,
        cr: zero,
        description: 'ล้างภาษีขายรอเรียกเก็บ',
      });
    }
    if (bal2103.gt(0)) {
      lines.push({
        accountCode: '11-2103',
        dr: zero,
        cr: bal2103,
        description: 'ล้างลูกหนี้ค้างชำระ (accrued)',
      });
    }
    if (bal2101.gt(0)) {
      lines.push({
        accountCode: '11-2101',
        dr: zero,
        cr: bal2101,
        description: 'ล้างลูกหนี้ Gross (excl. VAT)',
      });
    }
    if (bal2105.gt(0)) {
      lines.push({
        accountCode: '11-2105',
        dr: zero,
        cr: bal2105,
        description: 'ล้างลูกหนี้ภาษีขายรอฯ',
      });
    }
    if (bal21_2102.gt(0)) {
      lines.push({
        accountCode: '21-2101',
        dr: zero,
        cr: bal21_2102,
        description: 'ภาษีขาย ภ.พ.30 ถึงกำหนด (deferred, ม.82/3)',
      });
    }
    if (bal2106.gt(0)) {
      lines.push({
        accountCode: '41-1101',
        dr: zero,
        cr: bal2106,
        description: 'รับรู้รายได้ดอกเบี้ย (deferred)',
      });
    }

    // คำสั่งเจ้าของ 2026-08-08 (ข้อ 2): เงินคืนส่วนต่างลูกค้า — Cr เจ้าหนี้ 21-1107
    // วางก่อน plug → ขาดทุนเพิ่ม/กำไรลดเท่าเงินคืนโดยอัตโนมัติ (ไม่มีสูตรใหม่)
    if (input.customerRefund && input.customerRefund.gt(0)) {
      lines.push({
        accountCode: '21-1107',
        dr: zero,
        cr: input.customerRefund,
        description: `เงินคืนส่วนต่างลูกค้า ${input.customerRefund.toFixed(2)} ฿`,
      });
    }

    // ---- Loss/gain from the balance equation (not a separately re-derived formula) ----
    // Every line above already sweeps its account to the GL balance; whatever
    // is left over to balance the JE IS the loss (Cr > Dr) or gain (Dr > Cr).
    const sumDrSoFar = lines.reduce((s, l) => s.plus(l.dr), zero);
    const sumCrSoFar = lines.reduce((s, l) => s.plus(l.cr), zero);
    const lossOrGain = sumCrSoFar.minus(sumDrSoFar);

    // ---- Bad Debt provision (11-2102) — consume THEN release residual (Task 5) ----
    // TFRS §B61-B63 + TAS 36: derecognizing the receivable must consume any
    // existing allowance before recognizing 51-1102 loss (else double-count).
    // Whatever provision is LEFT after consuming the loss must be released
    // (Dr 11-2102 / Cr 51-1103) — once the contract is repossessed there is no
    // more receivable to provide against, so 11-2102 for this contract always
    // lands on exactly 0 after this JE (loss, gain, or exact-wash alike).
    const provisionBalance = await glBal('11-2102', 'cr');
    // M1 (final-review 2026-07-26): a negative pre-JE 11-2102 balance (Dr >
    // Cr — e.g. a past mis-posted JE) is a GL anomaly this template does NOT
    // auto-heal. Surface it instead of letting it silently zero itself out
    // via the `release.gt(0)` gate below.
    if (provisionBalance.lt(0)) {
      Sentry.captureMessage('JP5: negative 11-2102 balance', {
        level: 'warning',
        tags: { subsystem: 'bad-debt' },
        extra: { contractId: input.contractId, balance: provisionBalance.toFixed(2) },
      });
    }
    let remainingLoss = zero;
    let consume = zero;
    if (lossOrGain.gt(0)) {
      remainingLoss = lossOrGain;
      if (provisionBalance.gt(0)) {
        consume = Decimal.min(remainingLoss, provisionBalance);
      }
    }
    // `release` can be negative when `provisionBalance` itself is negative
    // (consume stays 0 in that branch) — the `release.gt(0)` gate below
    // already prevents any JE line from posting a negative "release", but the
    // METADATA field must not report a negative number either; see the
    // Decimal.max(0, ...) clamp on the returned `releasedProvision` below.
    const release = provisionBalance.minus(consume);

    if (consume.gt(0)) {
      lines.push({
        accountCode: '11-2102',
        dr: consume,
        cr: zero,
        description: `ใช้ค่าเผื่อหนี้สงสัยจะสูญที่ตั้งไว้ (${consume.toFixed(2)} ฿)`,
      });
      remainingLoss = remainingLoss.minus(consume);
    }
    if (release.gt(0)) {
      lines.push({
        accountCode: '11-2102',
        dr: release,
        cr: zero,
        description: 'คืนค่าเผื่อหนี้สงสัยจะสูญส่วนเกิน (release)',
      });
      lines.push({
        accountCode: '51-1103',
        dr: zero,
        cr: release,
        description: 'กลับรายการค่าเผื่อหนี้สงสัยจะสูญ (ยึดคืนแล้ว ไม่ต้องตั้งสำรองอีก)',
      });
    }

    if (remainingLoss.gt(0)) {
      lines.push({
        accountCode: '51-1102',
        dr: remainingLoss,
        cr: zero,
        description: consume.gt(0)
          ? 'ขาดทุนจากยึดเครื่อง (ส่วนเกินค่าเผื่อ)'
          : 'ขาดทุนจากยึดเครื่อง',
      });
    } else if (lossOrGain.lt(0)) {
      // Gain — Cr 41-1102
      lines.push({
        accountCode: '41-1102',
        dr: zero,
        cr: lossOrGain.abs(),
        description: 'รายได้จากการยึดสินค้า',
      });
    }

    return {
      contract: c,
      unpaid,
      accruedCount: accruedInsts.length,
      deferredCount: deferredInsts.length,
      accruedCreditNoteVat,
      // M1 clamp — never report a negative "released" amount in metadata,
      // even in the negative-provisionBalance GL-anomaly case above.
      releasedProvision: Decimal.max(0, release),
      lines,
    };
  }

  async execute(
    input: RepossessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const client = tx ?? this.prisma;
    const built = await this.buildJe(input, client);

    const result = await this.journal.createAndPost(
      {
        description: `ยึดเครื่อง — สัญญา ${built.contract.contractNumber} (${built.unpaid} งวดคงเหลือ)`,
        reference: `${built.contract.id}:repossession`,
        postedAt: input.postedAt,
        metadata: {
          tag: 'JP5',
          flow: 'repossession',
          contractId: built.contract.id,
          unpaidInstallments: built.unpaid,
          accruedInstallments: built.accruedCount,
          deferredInstallments: built.deferredCount,
          repossessionValue: input.repossessionValue.toFixed(2),
          // Wave 2 T2: Credit Note tracking (per ม.82/5)
          // CPA pro-rate (2026-07-26): a fully-paid-but-still-accrued edge case
          // (Payment row exists, amountPaid === amountDue, status not yet PAID)
          // can zero out cnVat even though accruedCount > 0 — key off the actual
          // amount, not the count, so this flag stays truthful (matches T3 write-off).
          creditNoteIssued: built.accruedCreditNoteVat.gt(0),
          creditNoteVatAmount: built.accruedCreditNoteVat.toFixed(2),
          // Task 5 (2026-07-26) — Bad Debt provision (11-2102) released back to
          // 51-1103 on this contract (0.00 when nothing was left to release).
          releasedProvision: built.releasedProvision.toFixed(2),
          ...(input.collectedByShop
            ? { collectedByShop: true, shopReceivable: input.depositAccountCode }
            : {}),
        },
        lines: built.lines,
      },
      tx,
    );

    return { entryNo: result.entryNumber };
  }

  /**
   * Dry-run for the UI "JOURNAL AUTO" card (owner 2026-07-20) — same buildJe
   * as execute(), no posting. Resolves account names from CoA like the JP4
   * quote preview does.
   */
  async previewJe(input: Omit<RepossessionInput, 'postedAt'>): Promise<RepossessionJePreview> {
    const built = await this.buildJe(input, this.prisma);

    const codes = [...new Set(built.lines.map((l) => l.accountCode))];
    const coaRows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));

    let totalDr = new Decimal(0);
    let totalCr = new Decimal(0);
    const lines = built.lines.map((l) => {
      totalDr = totalDr.plus(l.dr);
      totalCr = totalCr.plus(l.cr);
      return {
        accountCode: l.accountCode,
        accountName: nameMap.get(l.accountCode) ?? l.accountCode,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description ?? '',
      };
    });

    return {
      lines,
      totalDebit: totalDr.toFixed(2),
      totalCredit: totalCr.toFixed(2),
      isBalanced: totalDr.toFixed(2) === totalCr.toFixed(2),
    };
  }
}
