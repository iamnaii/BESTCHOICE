import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { PII_COLUMNS, plaintextColumnAnd, plaintextWhere } from './pdpa-backfill.util';

export interface PiiColumnPlaintextCount {
  column: string;
  plaintextCount: number;
}

export interface PdpaStatus {
  strictMode: boolean;
  totalCustomers: number;
  encryptedCount: number;
  plaintextCount: number;
  /** Per-column breakdown — every column listed in PII_COLUMNS, value
   *  = number of rows where `<column>` is non-empty but `<column>_encrypted`
   *  is NULL. Used by the UI to surface which exact field is missing. */
  plaintextByColumn: PiiColumnPlaintextCount[];
  /** Whether every existing Customer row has been backfilled. Equivalent
   *  to `plaintextCount === 0`. */
  readyForStrictMode: boolean;
  encryptionKeyConfigured: boolean;
  hashSaltConfigured: boolean;
}

/**
 * Phase 3 SP4 — PDPA status + strict-mode toggle.
 *
 * Owns the plaintext/encrypted count queries (per-column + aggregate),
 * the status card payload, and the strict-mode pre-flight guard that refuses
 * to flip STRICT on while plaintext rows still exist.
 *
 * Hard rule: **NEVER log decrypted PII**.
 */
@Injectable()
export class PdpaStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly piiService: CustomerPiiService,
  ) {}

  /**
   * Per-column count of rows where the plaintext column has data but the
   * encrypted column is still NULL.  DEEP review W3 — the previous
   * implementation only counted `nationalId`, missing customers whose
   * nationalId was empty but phone / email / address was populated.
   *
   * Returns one entry per PII column (with 0 counts for fully-encrypted
   * columns, so the UI can render a stable table).
   */
  async getPlaintextCountsByColumn(): Promise<PiiColumnPlaintextCount[]> {
    const out: PiiColumnPlaintextCount[] = [];
    for (const [plain, enc] of PII_COLUMNS) {
      // Each column needs its own count() — we can't compound them with
      // OR efficiently because we want per-column visibility for the UI.
      const count = await this.prisma.customer.count({
        where: {
          deletedAt: null,
          AND: plaintextColumnAnd(plain, enc),
        },
      });
      out.push({ column: plain, plaintextCount: count });
    }
    return out;
  }

  /**
   * Aggregate count of rows that still have ANY plaintext PII column with
   * a missing encrypted counterpart. Powers the headline "X customers
   * not yet encrypted" number on /settings#pdpa.
   *
   * One query — uses OR across all 11 columns so we don't accidentally
   * double-count a row that has multiple unencrypted columns.
   */
  async getAnyPlaintextCount(): Promise<number> {
    // plaintextWhere() = { deletedAt: null, OR: per-column plaintextColumnAnd(...) }
    // — the exact aggregate this method needs (single source of truth).
    return this.prisma.customer.count({ where: plaintextWhere() });
  }

  /**
   * Returns the strict-mode flag + plaintext/encrypted counts. Used by the
   * /settings#pdpa header card AND by the backfill UI as the "do we need
   * to keep going?" check.
   *
   * DEEP review W3 — counts now scan ALL 11 PII columns (was previously
   * only nationalId).
   */
  async getStatus(): Promise<PdpaStatus> {
    const [strictMode, totalCustomers, plaintextCount, plaintextByColumn] = await Promise.all([
      this.piiService.isStrictMode(),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.getAnyPlaintextCount(),
      this.getPlaintextCountsByColumn(),
    ]);

    const encryptedCount = Math.max(0, totalCustomers - plaintextCount);

    return {
      strictMode,
      totalCustomers,
      encryptedCount,
      plaintextCount,
      plaintextByColumn,
      readyForStrictMode: plaintextCount === 0,
      encryptionKeyConfigured: !!process.env.PII_ENCRYPTION_KEY,
      hashSaltConfigured: !!process.env.PII_HASH_SALT,
    };
  }

  /**
   * Flip the strict-mode flag. Rejects turning STRICT on while plaintext
   * rows still exist — otherwise the very first read would 400 with
   * "ข้อมูลยังไม่ได้เข้ารหัส" for all those rows.
   *
   * DEEP review W4 — the rejection now considers ALL 11 PII columns
   * (was previously only nationalId). Error message lists which columns
   * still have plaintext so the operator can scope the backfill.
   */
  async setStrictMode(enabled: boolean): Promise<{ strictMode: boolean }> {
    if (enabled) {
      const status = await this.getStatus();
      if (!status.encryptionKeyConfigured || !status.hashSaltConfigured) {
        throw new BadRequestException(
          'PII_ENCRYPTION_KEY / PII_HASH_SALT ยังไม่ได้ตั้งค่า — กรุณาตั้ง env vars ก่อนเปิด strict mode',
        );
      }
      if (status.plaintextCount > 0) {
        const offending = status.plaintextByColumn
          .filter((c) => c.plaintextCount > 0)
          .map((c) => `${c.column} (${c.plaintextCount})`)
          .join(', ');
        throw new BadRequestException(
          `ยังมีลูกค้าที่ยังไม่ได้เข้ารหัส รวม ${status.plaintextCount} แถว ` +
            `— คอลัมน์ที่ยังเหลือ: ${offending} — กรุณารัน Backfill ก่อนเปิด strict mode`,
        );
      }
    }
    await this.piiService.setStrictMode(enabled);
    return { strictMode: enabled };
  }
}
