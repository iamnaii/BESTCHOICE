import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export interface OverrideLine {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
}

export interface ValidationError {
  rule: 'V1' | 'V2' | 'V5';
  msg: string;
}

const TOLERANCE = new Decimal('0.01');

@Injectable()
export class JournalOverrideService {
  /**
   * Validate override JE lines against V1 (balanced), V2 (>=2 lines), V5 (Dr XOR Cr per line).
   * Short-circuits at first failing rule in order V2 → V5 → V1 so users see the most
   * fundamental problem first.
   */
  validate(lines: OverrideLine[]): void {
    // V2 — must have at least 2 lines
    if (lines.length < 2) {
      this.fail('V2', 'ต้องมีอย่างน้อย 2 บรรทัด');
    }

    // V5 — each line must be Dr XOR Cr
    for (const line of lines) {
      const hasDr = line.debit.gt(0);
      const hasCr = line.credit.gt(0);
      if (hasDr && hasCr) {
        this.fail('V5', `บรรทัด ${line.accountCode} มีทั้ง Dr และ Cr — ต้องระบุอย่างใดอย่างหนึ่ง`);
      }
      if (!hasDr && !hasCr) {
        this.fail('V5', `บรรทัด ${line.accountCode} ไม่มีทั้ง Dr และ Cr`);
      }
    }

    // V1 — balanced within 0.01 THB tolerance
    const drTotal = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const crTotal = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    const diff = drTotal.minus(crTotal).abs();
    if (diff.gt(TOLERANCE)) {
      this.fail('V1', `Dr (${drTotal.toFixed(2)}) ≠ Cr (${crTotal.toFixed(2)}) — ผลต่าง ${diff.toFixed(2)} บาท`);
    }
  }

  /**
   * Diff two JE line arrays by accountCode. Returns a Thai-language summary used in
   * audit log "diff_summary" field. Empty string when identical.
   *
   * Limitations: assumes one entry per accountCode per side. If a real-world override
   * needs duplicate accountCode lines, we'd need to use index-based keys.
   */
  computeDiffSummary(original: OverrideLine[], modified: OverrideLine[]): string {
    const origMap = new Map(original.map((l) => [l.accountCode, l]));
    const modMap = new Map(modified.map((l) => [l.accountCode, l]));

    const parts: string[] = [];

    // Modified lines (in both, but with different amounts)
    for (const [code, modLine] of modMap) {
      const origLine = origMap.get(code);
      if (!origLine) continue; // handled in "added" pass below
      const drChanged = !origLine.debit.eq(modLine.debit);
      const crChanged = !origLine.credit.eq(modLine.credit);
      if (drChanged) {
        parts.push(
          `แก้ Dr ${code} จาก ${this.fmt(origLine.debit)} → ${this.fmt(modLine.debit)}`,
        );
      }
      if (crChanged) {
        parts.push(
          `แก้ Cr ${code} จาก ${this.fmt(origLine.credit)} → ${this.fmt(modLine.credit)}`,
        );
      }
    }

    // Added lines (in modified, not in original)
    for (const [code, modLine] of modMap) {
      if (origMap.has(code)) continue;
      const side = modLine.debit.gt(0) ? 'Dr' : 'Cr';
      const amt = modLine.debit.gt(0) ? modLine.debit : modLine.credit;
      parts.push(`เพิ่มบรรทัด ${side} ${code} ${this.fmt(amt)}`);
    }

    // Removed lines (in original, not in modified)
    for (const [code, origLine] of origMap) {
      if (modMap.has(code)) continue;
      const side = origLine.debit.gt(0) ? 'Dr' : 'Cr';
      const amt = origLine.debit.gt(0) ? origLine.debit : origLine.credit;
      parts.push(`ลบบรรทัด ${side} ${code} ${this.fmt(amt)}`);
    }

    return parts.join('; ');
  }

  private fmt(d: Decimal): string {
    // Thai-style number with 2 decimals, comma thousands
    // Avoid Decimal.toNumber() — use toFixed + regex grouping (accounting rule)
    const [intPart, decPart = '00'] = d.toFixed(2).split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${intFormatted}.${decPart}`;
  }

  private fail(rule: 'V1' | 'V2' | 'V5', msg: string): never {
    throw new BadRequestException({
      message: 'ไม่ผ่านการตรวจสอบ Override JV',
      errors: [{ rule, msg } satisfies ValidationError],
    });
  }
}
