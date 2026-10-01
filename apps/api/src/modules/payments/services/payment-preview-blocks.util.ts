import { Prisma } from '@prisma/client';

/**
 * Pure block-tagging + per-block subtotal helper for the RecordPaymentWizard
 * JE preview (mockup §2A/§2B). No DB, no Nest — the preview service fetches the
 * already-posted 2A accrual lines and passes them in, so this stays a unit-testable
 * money-math function (mirrors `splitReceipt` / `computeInstallmentBreakdown`).
 *
 * Shape decision (Phase 1, non-breaking): the live receipt lines stay in `lines`
 * (so the existing flat panel keeps balancing pre-T2); the posted accrual context
 * is returned SEPARATELY in `accrual2A` + `subtotals['2A']`. T2 renders both.
 */

export type PreviewBlock = '2A' | '2B';

/** A JE line as the preview emits it — amounts already `.toFixed(2)` strings. */
export interface PreviewBasicLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface PreviewTaggedLine extends PreviewBasicLine {
  block: PreviewBlock;
  /** true = ลงบัญชีไปแล้ว (แสดงเป็นบริบท อ่านอย่างเดียว); false = จะลงเมื่อกดบันทึก. */
  posted: boolean;
}

export interface BlockSubtotal {
  debit: string;
  credit: string;
  balanced: boolean;
}

export interface PreviewBlocksResult {
  /** Live 2B receipt lines (what the save posts now), tagged `block:'2B', posted:false`. */
  lines: PreviewTaggedLine[];
  /**
   * รายการตั้งลูกหนี้งวด (2A) ของงวดนี้ — `posted: true` = ลงไปแล้ว (บริบท),
   * `posted: false` = ยังไม่ลง จะลงพร้อมการรับชำระนี้ (ตั้งลูกหนี้งวด ณ วันรับเงิน).
   */
  accrual2A?: { lines: PreviewTaggedLine[]; subtotal: BlockSubtotal };
  /** Per-block Dr/Cr subtotals + balance flag (mockup's "Dr = Cr =" per block). */
  subtotals: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
}

/**
 * Sum the per-line `.toFixed(2)` strings the service already emits. Intentional:
 * the subtotal must equal the sum of the values DISPLAYED in the rows (so the UI
 * reconciles exactly), and the upstream line values are already 2dp Decimals, so
 * Σ(round(line)) === round(Σ(raw)). Decimal arithmetic throughout — no float.
 */
function summarise(rows: { debit: string; credit: string }[]): BlockSubtotal {
  let dr = new Prisma.Decimal(0);
  let cr = new Prisma.Decimal(0);
  for (const r of rows) {
    dr = dr.plus(r.debit);
    cr = cr.plus(r.credit);
  }
  return {
    debit: dr.toFixed(2),
    credit: cr.toFixed(2),
    balanced: dr.toFixed(2) === cr.toFixed(2),
  };
}

/**
 * Combine the live 2B receipt lines with the (optional) 2A accrual lines into a
 * block-tagged result + per-block subtotals.
 *
 * - `accrualLines` omitted / empty → only a 2B block.
 * - `accrualLines` non-empty → a 2A block + live 2B. `accrualPosted` (default true)
 *   บอกว่า 2A ลงไปแล้ว (true) หรือจะลงพร้อมการรับชำระนี้ (false).
 */
export function buildPreviewBlocks(input: {
  liveLines: PreviewBasicLine[];
  accrualLines?: PreviewBasicLine[];
  accrualPosted?: boolean;
}): PreviewBlocksResult {
  const block2B: PreviewTaggedLine[] = input.liveLines.map((l) => ({
    ...l,
    block: '2B',
    posted: false,
  }));
  const subtotals: PreviewBlocksResult['subtotals'] = { '2B': summarise(block2B) };

  const accrual = input.accrualLines ?? [];
  if (accrual.length === 0) {
    return { lines: block2B, subtotals };
  }

  const block2A: PreviewTaggedLine[] = accrual.map((l) => ({
    ...l,
    block: '2A',
    posted: input.accrualPosted ?? true,
  }));
  const sub2A = summarise(block2A);
  subtotals['2A'] = sub2A;

  return { lines: block2B, accrual2A: { lines: block2A, subtotal: sub2A }, subtotals };
}
