import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * กระทบยอดลูกหนี้ผ่อนชำระ **รายสัญญา** — ลูกหนี้ใน GL เทียบยอดค้างในทะเบียนงวด (Task 16 · 2026-10-30)
 * ตัวคำนวณเดียวของตรวจกลางคืน `hp_receivable_reconciliation` (data-audit 06:00) และ `ReceivableReconService` (02:00)
 *
 * - **GL** = Σ(Dr − Cr) ของ 11-2101 + 11-2103 + 11-2105 ในรายการ `POSTED` ที่ไม่ถูกลบและ `metadata.contractId` = สัญญา —
 *   ความหมายเดียวกับ `glContractBalance(…, 'dr')` · ทุก CTE ในไฟล์นี้กรองบรรทัดที่ถูกลบ (`jl.deleted_at IS NULL`) — `glContractBalance`
 *   ไม่กรอง แต่ไม่มีโค้ดใดแก้ `journal_lines` หลังลง จึงได้ยอดเท่ากัน ·
 *   รายการยกเลิกด้วยมือ (`JournalService.void`) เปลี่ยนต้นฉบับเป็น VOIDED และรายการ REVERSAL ไม่มี metadata ⇒ หลุดคู่กัน ·
 *   รายการกลับของเทมเพลต copy `contractId` ⇒ หักล้างเอง · ไม่ใช้ 11-2102 (ค่าเผื่อหนี้สงสัยจะสูญ — contra ไม่ใช่ลูกหนี้)
 * - **ทะเบียน** = Σ(`amount_due − amount_paid`) ของ**ทุกแถวงวด**ที่ไม่ถูกลบ (ทุกสถานะ — งวดค้างเป็น `OVERDUE`) +
 *   ส่วนของ `amount_paid` ที่ไม่ได้ล้างลูกหนี้ = ค่าปรับที่รับจริง (Cr 42-1103 − Dr 52-1105 ต่อรายการ ไม่ติดลบ — ความหมายเดียวกับ
 *   `loadLateFeePaidByPaymentIds`) + เศษที่จ่ายเกินลูกหนี้ (Cr − Dr 53-1503) ของรายการรับชำระ (`tag` `receipt` / `2B`
 *   ที่ผูก `paymentId` และยังไม่ถูกกลับ) — `amount_paid` ของสัญญาปกติรวมค่าปรับ (`payment-receipt-orchestrator.ts`) · ขาด ≤ 1 บาท
 *   (52-1104) ไม่ต้องปรับ: `amount_paid` บวกส่วนขาดที่อนุมัติไว้แล้ว · ค่าปรับที่เก็บตอนปรับดิว (`reschedule-collect`) ไม่อยู่ใน
 *   `amount_paid` จึงไม่นับ
 * - **gap = GL − ทะเบียน** · ค่าที่คาด: สัญญาปกติ = 0 · สัญญานำเข้าระบบเก่า = `roundingDiff` ของสัญญา (|·| ≤ 1.00 บังคับตอนนำเข้า —
 *   `cli/legacy-backoffice/opening.ts` · ด่าน 6.4) ⇒ ไม่ต้องแยกสัญญานำเข้า · งวดที่ตั้งลูกหนี้งวดบางส่วน (`accrued*`) ไม่กระทบ:
 *   2A ทุกแบบย้ายยอดจาก 11-2101 + 11-2105 ไป 11-2103 เท่ากัน
 *
 * **ขอบเขต:** สัญญา `ACTIVE` / `OVERDUE` / `DEFAULT` เท่านั้น (คำตัดสินผู้คุมงาน 30/10) — **ข้อจำกัดที่รู้:** `TERMINATED` (บอกเลิก / ใบรับ
 * เครื่องคืนรอยืนยัน — ลูกหนี้ยังอยู่ใน GL จนยึดเครื่อง JP5) ไม่ถูกตรวจ · สัญญาที่ปิดแล้วไม่ถูกตรวจ (JP5 ไม่แตะงวดที่เหลือ ⇒
 * ทะเบียนค้างแต่ GL เป็น 0 โดยถูกต้อง)
 */

/**
 * เกณฑ์ต่อสัญญา — Tolerance Policy ≤ 1 บาท (`.claude/rules/accounting.md`) และเพดาน `roundingDiff` ของสัญญานำเข้า ·
 * **ทบทวนหลังซ้อมรอบ 2**: หลังวันตัด งวดนำเข้าที่ยอดเรียกเก็บต่ำกว่ายอดของงวดถูกชำระแล้วเศษของงวดนั้นหายจาก gap ขณะที่
 * งวดที่ยอดเรียกเก็บสูงกว่ายังอยู่ ⇒ |gap| ตามทฤษฎีขึ้นได้ถึง 0.01 × (งวด − 1) + 1.00
 */
export const CONTRACT_RECEIVABLE_TOLERANCE = new Decimal('1.00');

/** สถานะสัญญาที่กระทบยอด — ดูขอบเขตในหัวไฟล์ */
export const RECEIVABLE_RECON_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;

/** ลูกหนี้ผ่อนชำระ: gross ไม่รวม VAT · ค้างชำระ · VAT รอเรียกเก็บ */
export const HP_RECEIVABLE_ACCOUNTS = ['11-2101', '11-2103', '11-2105'] as const;

export type ContractReceivableGap = {
  contractId: string;
  contractNumber: string;
  branchId: string | null;
  glReceivable: Decimal;
  registerOutstanding: Decimal;
  gap: Decimal;
};

export type ContractScope = {
  /** จำกัดสัญญา (เทส / การตรวจเฉพาะกลุ่ม) — ไม่ส่ง = ทุกสัญญา · ว่าง = ไม่มีสัญญา */
  contractIds?: readonly string[];
};

type Client = Prisma.TransactionClient | PrismaClient;

/** `AND <column> IN (…)` ตามขอบเขต — ไม่ส่ง = ไม่กรอง · ว่าง = ไม่มีแถว · `column` เป็นค่าคงที่ในโค้ดเท่านั้น */
export function contractScopeFilter(column: string, scope?: ContractScope): Prisma.Sql {
  if (!scope?.contractIds) return Prisma.empty;
  if (scope.contractIds.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join([...scope.contractIds])})`;
}

/**
 * `SELECT id, contract_number, branch_id` ของสัญญาในขอบเขตกระทบยอด — ใช้เป็น CTE `scope` (ตรวจ VAT รอเรียกเก็บรายสัญญาของ
 * data-audit ใช้ขอบเขตเดียวกัน)
 */
export function receivableReconScopeSql(scope?: ContractScope): Prisma.Sql {
  return Prisma.sql`
    SELECT c.id, c.contract_number, c.branch_id
    FROM contracts c
    WHERE c.deleted_at IS NULL
      AND c.status::text IN (${Prisma.join([...RECEIVABLE_RECON_CONTRACT_STATUSES])})
      ${contractScopeFilter('c.id', scope)}`;
}

/** ทุกสัญญาในขอบเขต (รวมสัญญาที่ gap = 0) เรียงตามเลขสัญญา */
export async function loadContractReceivableGaps(
  client: Client,
  scope?: ContractScope,
): Promise<ContractReceivableGap[]> {
  const rows = await client.$queryRaw<
    {
      contract_id: string;
      contract_number: string;
      branch_id: string | null;
      gl_receivable: Prisma.Decimal;
      register_outstanding: Prisma.Decimal;
    }[]
  >`
    WITH scope AS (${receivableReconScopeSql(scope)}),
    gl AS (
      SELECT je.metadata->>'contractId' AS contract_id, SUM(jl.debit - jl.credit) AS receivable
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND jl.deleted_at IS NULL
        AND jl.account_code IN (${Prisma.join([...HP_RECEIVABLE_ACCOUNTS])})
        AND je.metadata->>'contractId' IN (SELECT id FROM scope)
      GROUP BY je.metadata->>'contractId'
    ),
    receipt_entry AS (
      SELECT je.id, je.metadata->>'paymentId' AS payment_id,
        COALESCE(SUM(jl.credit) FILTER (WHERE jl.account_code = '42-1103'), 0) AS fee_gross,
        COALESCE(SUM(jl.debit) FILTER (WHERE jl.account_code = '52-1105'), 0) AS fee_waived,
        COALESCE(SUM(jl.credit - jl.debit) FILTER (WHERE jl.account_code = '53-1503'), 0) AS rounding
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
      WHERE je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'tag' IN ('receipt', '2B')
        AND je.metadata->>'paymentId' IS NOT NULL
        AND COALESCE(je.metadata->>'reversed', 'false') <> 'true'
        AND jl.account_code IN ('42-1103', '52-1105', '53-1503')
      GROUP BY je.id, je.metadata->>'paymentId'
    ),
    paid_not_receivable AS (
      SELECT p.contract_id, SUM(GREATEST(r.fee_gross - r.fee_waived, 0) + r.rounding) AS amount
      FROM receipt_entry r
      JOIN payments p ON p.id = r.payment_id
      WHERE p.deleted_at IS NULL
        AND p.contract_id IN (SELECT id FROM scope)
      GROUP BY p.contract_id
    ),
    reg AS (
      SELECT p.contract_id, SUM(p.amount_due - p.amount_paid) AS due_minus_paid
      FROM payments p
      WHERE p.deleted_at IS NULL
        AND p.contract_id IN (SELECT id FROM scope)
      GROUP BY p.contract_id
    )
    SELECT s.id AS contract_id, s.contract_number, s.branch_id,
      COALESCE(gl.receivable, 0) AS gl_receivable,
      COALESCE(reg.due_minus_paid, 0) + COALESCE(x.amount, 0) AS register_outstanding
    FROM scope s
    LEFT JOIN gl ON gl.contract_id = s.id
    LEFT JOIN reg ON reg.contract_id = s.id
    LEFT JOIN paid_not_receivable x ON x.contract_id = s.id
    ORDER BY s.contract_number
  `;
  return rows.map((r) => {
    const glReceivable = new Decimal(r.gl_receivable.toString());
    const registerOutstanding = new Decimal(r.register_outstanding.toString());
    return {
      contractId: r.contract_id,
      contractNumber: r.contract_number,
      branchId: r.branch_id,
      glReceivable,
      registerOutstanding,
      gap: glReceivable.minus(registerOutstanding),
    };
  });
}

/** สัญญาที่ |gap| เกิน `CONTRACT_RECEIVABLE_TOLERANCE` */
export function isReceivableGapBreached(row: Pick<ContractReceivableGap, 'gap'>): boolean {
  return row.gap.abs().gt(CONTRACT_RECEIVABLE_TOLERANCE);
}
