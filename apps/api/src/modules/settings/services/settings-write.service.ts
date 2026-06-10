import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { resolveSettingsAccessRoles } from '../settings-access.guard';
import {
  READ_ONLY_KEYS,
  DOC_PREFIX_REGEX,
  VALID_DOC_NUMBER_FORMATS,
  VALID_DOC_NUMBER_RESET_CYCLES,
  redact,
} from '../settings.constants';

/**
 * Write/mutation slice of the decomposed SettingsService (Wave-4). Owns the
 * SOLE `$transaction` in the module (the bulkUpdate upsert-array). All method
 * bodies are byte-identical to the original; only `this.prisma`/`this.audit`
 * field resolution + import paths changed.
 */
@Injectable()
export class SettingsWriteService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.systemConfig.findMany({
      where: { deletedAt: null },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * D1.1.2.1 — value-level validation for known keys that need stricter
   * shape than the generic snake_case key check on the DTO. Throws
   * BadRequestException with a Thai message on the first violation.
   *
   * Currently checks:
   *  - `doc_prefix_per_type` — must parse as JSON object; every present
   *    value must match `DOC_PREFIX_REGEX` (2-4 uppercase Latin letters).
   *    Unknown keys are silently ignored (forward-compat with future
   *    DocumentType additions).
   */
  private validateKeyValue(key: string, value: string): void {
    if (key === 'doc_prefix_per_type') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadRequestException(
          'doc_prefix_per_type ต้องเป็น JSON object ที่ถูกต้อง',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BadRequestException(
          'doc_prefix_per_type ต้องเป็น JSON object (ไม่ใช่ array หรือ primitive)',
        );
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'string' || !DOC_PREFIX_REGEX.test(v)) {
          throw new BadRequestException(
            `doc_prefix_per_type[${k}] ต้องเป็นตัวอักษรพิมพ์ใหญ่ A-Z จำนวน 2-4 ตัว`,
          );
        }
      }
    }
    // P2-SP2 — whitelist guard for doc-number layout + reset cadence.
    if (key === 'doc_number_format') {
      if (!(VALID_DOC_NUMBER_FORMATS as readonly string[]).includes(value)) {
        throw new BadRequestException(
          `doc_number_format ต้องเป็นหนึ่งใน: ${VALID_DOC_NUMBER_FORMATS.join(', ')}`,
        );
      }
    }
    if (key === 'doc_number_reset_cycle') {
      if (!(VALID_DOC_NUMBER_RESET_CYCLES as readonly string[]).includes(value)) {
        throw new BadRequestException(
          `doc_number_reset_cycle ต้องเป็นหนึ่งใน: ${VALID_DOC_NUMBER_RESET_CYCLES.join(', ')}`,
        );
      }
    }
  }

  /**
   * Single key update with audit trail. Callers must pass userId — passing
   * null/undefined skips the audit log and is reserved for system-internal
   * writes (e.g. automated migrations).
   */
  /**
   * D1.3.2.2 (S3 defense-in-depth) — Service-side mirror of
   * `SettingsAccessGuard`. Mutating callsites (`update`, `bulkUpdate`)
   * invoke this with the request user's role. Throws ForbiddenException
   * if the role is not in the currently-allowed bundle.
   *
   * The guard is the primary gate; this check survives a future refactor
   * that accidentally widens the controller decorator or replaces the
   * guard pipeline. `userRole === undefined` is treated as "skip check"
   * for two legitimate cases:
   *   - system-internal callers (cron jobs, migrations) that don't carry
   *     a user identity (matches existing `userId === undefined` skip),
   *   - unit tests that don't construct a full guard pipeline.
   */
  private async assertCanWriteSettings(userRole: string | undefined): Promise<void> {
    if (userRole === undefined) return; // system-internal / test bypass
    const allowed = await resolveSettingsAccessRoles(this.prisma);
    if (!allowed.has(userRole)) {
      throw new ForbiddenException(
        `ไม่มีสิทธิ์แก้ไขการตั้งค่า (role ปัจจุบัน: ${userRole})`,
      );
    }
  }

  async update(key: string, value: string, userId?: string, userRole?: string) {
    await this.assertCanWriteSettings(userRole);
    if (READ_ONLY_KEYS.has(key)) {
      throw new BadRequestException(
        `key "${key}" เป็น read-only ตามกฎหมาย/ระเบียบ — ไม่สามารถแก้ไขผ่านระบบได้`,
      );
    }
    this.validateKeyValue(key, value);
    const before = await this.prisma.systemConfig.findUnique({ where: { key } });
    const updated = await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    await this.audit.log({
      userId,
      action: before ? 'SYSTEM_CONFIG_UPDATE' : 'SYSTEM_CONFIG_CREATE',
      entity: 'SystemConfig',
      entityId: key,
      oldValue: before ? { key, value: redact(key, before.value) } : undefined,
      newValue: { key, value: redact(key, value) },
    });
    return updated;
  }

  /**
   * D1.1.3.1 follow-up — defensive normalisation for VAT-rate writes.
   *
   * Legacy frontends (or operators using a generic SQL client) may still
   * send `{ key: 'vat_pct', value: '0.07' }` to `/settings`. After PR #940
   * (the canonical `VAT_RATE` migration) any such write resurrects the
   * orphan key and `VatRateBootstrapService` warns on the next boot.
   *
   * This helper rewrites the item in-place: `vat_pct` writes become
   * `VAT_RATE` writes, converting decimal form to percent form when
   * needed. `vat_rate` (older legacy) treated the same. Already-canonical
   * `VAT_RATE` items pass through unchanged.
   *
   * Idempotent: if both legacy and canonical keys are sent in the same
   * batch, the canonical wins (last write wins inside the same batch).
   */
  private normaliseVatRateWrites(
    items: { key: string; value: string }[],
  ): { key: string; value: string }[] {
    return items.map((item) => {
      if (item.key !== 'vat_pct' && item.key !== 'vat_rate') return item;
      const trimmed = String(item.value ?? '').trim();
      if (!trimmed) return { key: 'VAT_RATE', value: '' };
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        return { key: 'VAT_RATE', value: trimmed };
      }
      // Values < 1 are decimal-form ('0.07') → multiply by 100 for percent.
      // Values >= 1 are already percent-form. Round to 4 decimal places so
      // floating-point math (0.07*100=7.000000000000001) doesn't leak into
      // the audit log or back to the UI.
      const asPercent = n < 1 ? n * 100 : n;
      const rounded = Math.round(asPercent * 10000) / 10000;
      return { key: 'VAT_RATE', value: String(rounded) };
    });
  }

  async bulkUpdate(
    items: { key: string; value: string }[],
    userId?: string,
    userRole?: string,
  ) {
    // D1.3.2.2 (S3) — defense-in-depth role check (mirrors SettingsAccessGuard).
    await this.assertCanWriteSettings(userRole);
    // D1.1.3.3 — reject the whole batch if any read-only key is present
    // (atomicity: don't silently drop entries; the caller has a UI bug).
    const readOnlyHit = items.find((i) => READ_ONLY_KEYS.has(i.key));
    if (readOnlyHit) {
      throw new BadRequestException(
        `key "${readOnlyHit.key}" เป็น read-only ตามกฎหมาย/ระเบียบ — ไม่สามารถแก้ไขผ่านระบบได้`,
      );
    }
    // Validate all items up front — fail the entire batch on the first bad
    // value so a partially-applied bulk update can't leak through.
    for (const item of items) {
      this.validateKeyValue(item.key, item.value);
    }
    // D1.1.3.1 follow-up — rewrite legacy VAT keys before persist.
    items = this.normaliseVatRateWrites(items);
    // Fetch "before" snapshot in one query so the transaction stays bounded.
    const keys = items.map((i) => i.key);
    const existing = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const existingMap = new Map(existing.map((e) => [e.key, e.value]));

    const updated = await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.systemConfig.upsert({
          where: { key: item.key },
          update: { value: item.value },
          create: { key: item.key, value: item.value },
        }),
      ),
    );

    // Log audit entries outside the transaction — audit failures must never
    // roll back config updates. AuditService itself swallows failures.
    for (const item of items) {
      const prior = existingMap.get(item.key);
      await this.audit.log({
        userId,
        action: prior !== undefined ? 'SYSTEM_CONFIG_UPDATE' : 'SYSTEM_CONFIG_CREATE',
        entity: 'SystemConfig',
        entityId: item.key,
        oldValue: prior !== undefined ? { key: item.key, value: redact(item.key, prior) } : undefined,
        newValue: { key: item.key, value: redact(item.key, item.value) },
      });
    }

    return updated;
  }
}
