import Decimal from 'decimal.js';
import type { JeBlock } from './csv-fixture-loader';

export interface ActualJe {
  tag: string;
  lines: { code: string; dr: Decimal; cr: Decimal }[];
}

export interface DiffResult {
  ok: boolean;
  diffs: string[];
}

export function diffGoldenJE(
  expected: JeBlock[],
  actual: ActualJe[],
  tolerance = '0.01',
): DiffResult {
  const tol = new Decimal(tolerance);
  const diffs: string[] = [];

  if (expected.length !== actual.length) {
    diffs.push(`Block count: expected ${expected.length}, got ${actual.length}`);
  }

  for (const exp of expected) {
    const act = actual.find((a) => a.tag === exp.tag);
    if (!act) {
      diffs.push(`Missing block tag=${exp.tag}`);
      continue;
    }
    for (const expLine of exp.lines) {
      const actLine = act.lines.find((l) => l.code === expLine.code);
      if (!actLine) {
        diffs.push(`[${exp.tag}] missing line code=${expLine.code}`);
        continue;
      }
      const drDiff = actLine.dr.minus(new Decimal(expLine.dr)).abs();
      const crDiff = actLine.cr.minus(new Decimal(expLine.cr)).abs();
      if (drDiff.gt(tol)) {
        diffs.push(
          `[${exp.tag}] ${expLine.code} Dr expected=${expLine.dr} got=${actLine.dr.toFixed(2)}`,
        );
      }
      if (crDiff.gt(tol)) {
        diffs.push(
          `[${exp.tag}] ${expLine.code} Cr expected=${expLine.cr} got=${actLine.cr.toFixed(2)}`,
        );
      }
    }
  }

  return { ok: diffs.length === 0, diffs };
}
