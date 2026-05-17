import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import {
  DEFAULT_DOC_PREFIX_MAP,
  SettingsService,
} from '../../settings/settings.service';

/**
 * D1.1.2.4 — SystemConfig key `doc_sequence_table_enabled` (default `'false'`).
 *
 * Owner picked "accept current behavior" for Q3 — current implementation uses
 * a PostgreSQL advisory lock + `MAX(docNumber)` lookup inside the same DB
 * transaction. This works correctly under normal load (~100 docs/day) and
 * doesn't require an additional table.
 *
 * The flag is reserved as a **forward-extension point** for a future migration
 * to a dedicated `DocumentSequence` model. When `true`, the service throws
 * `NotImplementedException` so the OWNER realizes the migration hasn't
 * happened yet — silent fallback would create the impression a feature exists
 * when it doesn't. To enable the new mode in the future:
 *
 *  1. Add `model DocumentSequence` to `schema.prisma` with `@@unique([type, period])`
 *  2. Implement a `useSequenceTable()` branch in `next()` that does
 *     `upsert + increment` against the new table inside the same `$transaction`
 *  3. Drop the `NotImplementedException` throw
 *
 * Until then, OWNER setting this to `true` is a configuration error and the
 * exception is the correct response.
 */
@Injectable()
export class DocNumberService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-day) key. Mirrors OI/RT pattern.
   *
   * Format: <TYPE>-YYYYMMDD-NNNN — daily reset, 4-digit seq.
   *
   * D1.1.2.1 — prefix is now sourced from SystemConfig key
   * `doc_prefix_per_type` via `SettingsService.getDocPrefixMap()`. Falls back
   * to the hardcoded `DEFAULT_DOC_PREFIX_MAP` when no override is configured
   * or the stored value is malformed. The lock key + lookup query both use
   * the resolved prefix, so changing the override at runtime applies to the
   * next-issued number without restart.
   *
   * D1.1.2.4 — when `doc_sequence_table_enabled = 'true'`, throws
   * `NotImplementedException`. See class docstring for rationale.
   *
   * `issueDate` convention (W5): the BKK-day is derived from the user-chosen
   * `documentDate` (NOT server "now"), so a same-day creation backdated to
   * yesterday will still number under yesterday's sequence. This is intentional
   * — auditors expect a doc dated 2026-05-13 to carry an EX-20260513-NNNN
   * number regardless of when it was keyed in. The per-day advisory lock still
   * prevents collisions across concurrent backdates onto the same day. If the
   * convention ever needs to change, see the W5 note in fix report v1.1.
   *
   * W4 — explicit throw when seq > 9999 (would overflow the 4-digit slot and
   * silently produce a 5-digit number that sorts wrong). Real-world limit is
   * ~100 docs/day, so this is purely a guard against runaway loops / data
   * corruption / future high-volume regimes.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    // D1.1.2.4 — sequence table not implemented; reject explicitly if OWNER
    // has flipped the flag without an accompanying migration.
    if (await this.isSequenceTableEnabled()) {
      throw new NotImplementedException(
        'Sequence table mode not implemented yet — please disable this flag (doc_sequence_table_enabled = false)',
      );
    }

    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    const prefixMap = await this.resolvePrefixMap();
    const prefixLetters = prefixMap[type];
    const prefix = `${prefixLetters}-${yyyymmdd}-`;
    const lockKey = this.hashLockKey(`expdoc:${type}:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last
      ? parseInt(last.number.slice(prefix.length), 10) || 0
      : 0;
    const nextSeq = lastSeq + 1;
    if (nextSeq > 9999) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${prefixLetters} เกิน 9999 ใน 1 วัน (BKK ${yyyymmdd}) — ติดต่อผู้ดูแลระบบ`,
      );
    }
    const seq = String(nextSeq).padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /**
   * D1.1.2.1 — fetch the active prefix map. Pulls from SettingsService when
   * available; falls back to the static `DEFAULT_DOC_PREFIX_MAP` if any error
   * surfaces (defensive: doc creation must never block on the settings query).
   */
  private async resolvePrefixMap(): Promise<Record<DocumentType, string>> {
    try {
      return await this.settings.getDocPrefixMap();
    } catch {
      return { ...DEFAULT_DOC_PREFIX_MAP };
    }
  }

  /**
   * D1.1.2.4 — read `doc_sequence_table_enabled` flag. Defensive: any error
   * resolving the flag (DB down, malformed value) is treated as "false" so
   * doc creation continues using the advisory-lock fast path. Only an
   * explicit `'true'` / `'1'` value (case-insensitive) enables the throw branch.
   */
  private async isSequenceTableEnabled(): Promise<boolean> {
    try {
      const raw = await this.settings.getKey('doc_sequence_table_enabled');
      if (!raw) return false;
      const v = raw.trim().toLowerCase();
      return v === 'true' || v === '1';
    } catch {
      return false;
    }
  }

  /** Asia/Bangkok local YYYYMMDD via Intl (BKK is UTC+7, no DST). */
  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  /** Deterministic 32-bit hash for advisory lock keys. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
