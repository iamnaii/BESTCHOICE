import { Decimal } from '@prisma/client/runtime/library';

/**
 * Daily straight-line depreciation schedule generator.
 *
 * Spec (ซื้อทรัพย์สิน — คำนวณค่าเสื่อมราคาแบบรายวัน):
 *   ค่าเสื่อมต่อวัน  = (ราคาทุน − มูลค่าซาก) ÷ (อายุการใช้งานเป็นปี × 365)
 *   ค่าเสื่อมต่องวด = ค่าเสื่อมต่อวัน × จำนวนวันในงวดนั้น
 *
 * Business rules:
 *   R1 (rounding)   — each period ROUND_HALF_UP to 2 dp; the final period is
 *                     forced so Σ = (cost − salvage) exactly, final NBV = salvage.
 *   R2 (first period) — counts from startDate to month-end inclusive
 *                     (start 30 Apr → 1 day; start 15 Apr → 16 days).
 *   R3 (year)       — fixed 365 days/year.
 *   R4 (disposal)   — stop on disposalDate; that period counts actual days used
 *                     and is NOT force-filled to salvage (early disposal keeps NBV).
 *   R5 (precision)  — dailyDepr kept at 4 dp; period amounts at 2 dp.
 *
 * Periods are calendar months keyed "YYYY-MM". All date math uses UTC calendar
 * components so it is deterministic regardless of server timezone.
 */

export interface DepreciationScheduleInput {
  purchaseCost: Decimal | number | string;
  residualValue: Decimal | number | string;
  usefulLifeMonths: number;
  /** Depreciation start (= asset.purchaseDate). Time component is ignored. */
  startDate: Date;
  /** Optional disposal/sale date — stops depreciation on this day (R4). */
  disposalDate?: Date | null;
}

export interface DepreciationScheduleRow {
  /** "YYYY-MM" */
  period: string;
  /** Depreciable days that fall within this calendar month. */
  days: number;
  /** Posted amount for this period (2 dp). */
  amount: Decimal;
  /** Cumulative depreciation through this period (2 dp). */
  accumulated: Decimal;
  /** purchaseCost − accumulated (2 dp). */
  netBookValue: Decimal;
  /** True for the last period of the schedule. */
  isFinal: boolean;
}

export interface DepreciationSchedule {
  /** Daily depreciation rate (4 dp). */
  dailyDepr: Decimal;
  /** Nominal depreciable days = round(months × 365 / 12). */
  totalDays: number;
  rows: DepreciationScheduleRow[];
}

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
function round4(d: Decimal): Decimal {
  return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Last day-of-month (1-31) for the given UTC year/month0. */
function lastDomUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Inclusive day count between two UTC calendar dates (a ≤ b ⇒ ≥ 1). */
function daysInclusive(
  aY: number,
  aM0: number,
  aD: number,
  bY: number,
  bM0: number,
  bD: number,
): number {
  const a = Date.UTC(aY, aM0, aD);
  const b = Date.UTC(bY, bM0, bD);
  return Math.round((b - a) / 86_400_000) + 1;
}

export function buildDepreciationSchedule(
  input: DepreciationScheduleInput,
): DepreciationSchedule {
  const purchaseCost = new Decimal(input.purchaseCost.toString());
  const residualValue = new Decimal(input.residualValue.toString());
  const base = round2(purchaseCost.minus(residualValue));
  const months = input.usefulLifeMonths;

  if (base.lte(0) || months <= 0) {
    return { dailyDepr: new Decimal(0), totalDays: 0, rows: [] };
  }

  // R3: fixed 365-day year. usefulLife is stored in months → years = months/12.
  const totalDays = Math.round((months * 365) / 12);
  const dailyDepr = round4(base.div(totalDays));

  const sY = input.startDate.getUTCFullYear();
  const sM0 = input.startDate.getUTCMonth();
  const sD = input.startDate.getUTCDate();

  const dispAbs =
    input.disposalDate != null
      ? Date.UTC(
          input.disposalDate.getUTCFullYear(),
          input.disposalDate.getUTCMonth(),
          input.disposalDate.getUTCDate(),
        )
      : null;

  const rows: DepreciationScheduleRow[] = [];
  let accumulated = new Decimal(0);
  let cy = sY;
  let cm = sM0;
  let cd = sD; // first period starts on the purchase day (R2); day 1 thereafter
  const guardMax = months + 36;

  for (let guard = 0; accumulated.lt(base) && guard < guardMax; guard++) {
    const cursorStartAbs = Date.UTC(cy, cm, cd);
    // Disposal already passed before this period begins — nothing left (R4 edge).
    if (dispAbs != null && dispAbs < cursorStartAbs) break;

    const lastDom = lastDomUTC(cy, cm);
    const monthEndAbs = Date.UTC(cy, cm, lastDom);

    let periodEndDom = lastDom;
    let disposedHere = false;
    if (dispAbs != null && dispAbs <= monthEndAbs) {
      periodEndDom = new Date(dispAbs).getUTCDate();
      disposedHere = true;
    }

    const days = daysInclusive(cy, cm, cd, cy, cm, periodEndDom);
    if (days <= 0) break; // disposal before the cursor — nothing left to depreciate

    let amount = round2(dailyDepr.times(days));
    let isFinal = false;
    const wouldReach = accumulated.plus(amount);

    if (!disposedHere && wouldReach.gte(base)) {
      // R1: natural end of life — force exact so Σ = base, final NBV = salvage.
      amount = base.minus(accumulated);
      isFinal = true;
    } else if (disposedHere) {
      // R4: early disposal — actual days, but never depreciate past base.
      if (wouldReach.gt(base)) amount = base.minus(accumulated);
      isFinal = true;
    }

    accumulated = accumulated.plus(amount);
    rows.push({
      period: `${cy}-${String(cm + 1).padStart(2, '0')}`,
      days,
      amount: round2(amount),
      accumulated: round2(accumulated),
      netBookValue: round2(purchaseCost.minus(accumulated)),
      isFinal,
    });

    if (isFinal) break;

    cm += 1;
    if (cm > 11) {
      cm = 0;
      cy += 1;
    }
    cd = 1;
  }

  return { dailyDepr, totalDays, rows };
}

/**
 * Convenience lookup — the posted amount for a single "YYYY-MM" period, or null
 * if the period is outside the schedule window. Used by the depreciation
 * template / preview to stay consistent with the full schedule.
 */
export function depreciationForPeriod(
  input: DepreciationScheduleInput,
  period: string,
): DepreciationScheduleRow | null {
  const { rows } = buildDepreciationSchedule(input);
  return rows.find((r) => r.period === period) ?? null;
}
