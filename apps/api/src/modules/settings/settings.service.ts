import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Keys whose values are secrets (API tokens, bank credentials). The audit
 * log records the key name + that a change happened, but never the raw
 * value — we don't want cleartext secrets sitting in AuditLog JSON.
 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /private[_-]?key/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
}

function redact(key: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return isSensitiveKey(key) ? '[REDACTED]' : value;
}

@Injectable()
export class SettingsService {
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
   * Single key update with audit trail. Callers must pass userId — passing
   * null/undefined skips the audit log and is reserved for system-internal
   * writes (e.g. automated migrations).
   */
  async update(key: string, value: string, userId?: string) {
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
   * Read a single SystemConfig value by key. Returns null when key missing.
   * Used by typed accessors below; not exposed through the controller.
   */
  async getKey(key: string): Promise<string | null> {
    const row = await this.prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  private async readNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.getKey(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  private async readBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.getKey(key);
    if (raw == null) return fallback;
    const v = raw.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return fallback;
  }

  /**
   * D1.* — UI feature flags accessible to ANY authenticated user (not OWNER-only).
   * Keep this method's response shape small and additive — every D1 item that
   * needs a runtime UI toggle should land here so the web app can fetch one
   * lightweight payload at app boot instead of per-feature endpoints.
   *
   * Defaults match the spec-defined "on" behaviour so first-boot behaviour
   * is identical whether the SystemConfig key has been seeded or not.
   */
  /**
   * D1.2.7.2 — DB-driven reverse-reason dropdown. JSON-encoded array of
   * `{code, label}` objects stored in SystemConfig key `reverse_reasons`.
   * Default = the 6 canonical reasons. Caller is responsible for treating
   * an empty/invalid stored list as "use default" — never as "empty list".
   */
  async getReverseReasons(): Promise<{ code: string; label: string }[]> {
    const raw = await this.getKey('reverse_reasons');
    const defaults: { code: string; label: string }[] = [
      { code: 'data_entry_error', label: 'ป้อนข้อมูลผิด' },
      { code: 'wrong_vendor', label: 'ผู้ขายผิด' },
      { code: 'wrong_amount', label: 'จำนวนเงินผิด' },
      { code: 'duplicate_entry', label: 'ข้อมูลซ้ำ' },
      { code: 'cancel_transaction', label: 'ยกเลิกรายการ' },
      { code: 'other', label: 'อื่นๆ (ระบุรายละเอียด)' },
    ];
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          (r) =>
            r && typeof r === 'object' && typeof r.code === 'string' && typeof r.label === 'string',
        )
      ) {
        return parsed;
      }
      return defaults;
    } catch {
      return defaults;
    }
  }

  async getUiFlags(): Promise<{
    /** D1.2.8.2 — show ม.42 tax-exempt warning when a payroll custom-income line is marked non-taxable. Default true. */
    taxExemptWarningEnabled: boolean;
    /** D1.2.7.1 — require reason on void/reverse dialog. Default true. */
    reverseReasonRequired: boolean;
    /** D1.2.7.2 — configurable reverse-reason dropdown. Always at least the 6 defaults. */
    reverseReasons: { code: string; label: string }[];
    /** D1.2.7.3 — soft warning threshold (days) when reverse backdate exceeds this; default 7. UI-only, no server block. */
    reverseManagerApprovalDays: number;
    /** D1.2.6.3 — broader backdate warning threshold (days). Default 30. Distinct from D1.2.7.3 (the manager-approval threshold at 7d). */
    paymentDateWarningBackdate: number;
    /** D1.2.6.4 — allow forward-dated transactions (reverse JE / payment / etc.). Default true. */
    paymentDateAllowFuture: boolean;
    /**
     * D1.2.6.1 — day-of-month when the accounting period closes. Default 31
     * (= last day of each month). Currently INFORMATIONAL only: period-lock
     * still anchors at calendar month-end. A future enhancement can shift
     * the period boundary when this is not 31. Validated 1–31.
     */
    periodCloseDay: number;
    /** D1.2.2.7 — render verification QR code on voucher footers. Default true. */
    voucherShowQrCode: boolean;
    /**
     * D1.2.2.5 — primary theme color hex string. Default '#10b981' (emerald,
     * Tailwind v4 emerald-500). Currently INFORMATIONAL only — Tailwind v4's
     * `@theme` block uses --color-primary-50..900 scale, so single-color
     * override doesn't directly drive the design tokens. Future enhancement
     * can either compute the full scale from this hex or switch to a CSS
     * variable system that respects the override. Stored as hex string;
     * caller validates format.
     */
    themeColor: string;
    /**
     * D1.2.2.6 — UI language preference. 'th' default. The web app applies
     * the value to `document.documentElement.lang` at boot, but translation
     * tables are NOT yet provided — strings remain in their authored Thai
     * form. Future enhancement adds an i18n framework (react-i18next or
     * similar) consuming this setting. OWNER editing today still affects
     * accessibility readers via the lang attr.
     */
    language: 'th' | 'en';
    /**
     * D1.4.2.3 — react-query staleTime (seconds) for aggregated report
     * queries (P&L, monthly P&L, trial balance, balance sheet, entity
     * profit). Default 300s (5 min), valid 30–7200 (clamped). Actively
     * wired into `ProfitLossPage`. Originally SKIP per Phase 2; shipped
     * per owner directive 2026-05-17 to reach 100% A1 coverage.
     */
    cacheTtlReports: number;
  }> {
    const taxExemptWarningEnabled = await this.readBoolean(
      'TAX_EXEMPT_WARNING_ENABLED',
      true,
    );
    const reverseReasonRequired = await this.readBoolean(
      'reverse_reason_required',
      true,
    );
    const reverseReasons = await this.getReverseReasons();
    const reverseManagerApprovalDays = await this.readNumber(
      'reverse_manager_approval_days',
      7,
    );
    const paymentDateWarningBackdate = await this.readNumber(
      'payment_date_warning_backdate',
      30,
    );
    const paymentDateAllowFuture = await this.readBoolean(
      'payment_date_allow_future',
      true,
    );
    // D1.2.6.1 — clamp to valid day-of-month range (1–31) on read so a
    // bad SystemConfig row can't cause undefined behaviour downstream.
    const periodCloseDayRaw = await this.readNumber('period_close_day', 31);
    const periodCloseDay =
      Number.isInteger(periodCloseDayRaw) && periodCloseDayRaw >= 1 && periodCloseDayRaw <= 31
        ? periodCloseDayRaw
        : 31;
    const voucherShowQrCode = await this.readBoolean('voucher_show_qr_code', true);
    // D1.2.2.5 — theme color (hex). Validate `^#[0-9a-fA-F]{6}$`.
    const themeColorRaw = await this.getKey('theme_color');
    const themeColor =
      themeColorRaw && /^#[0-9a-fA-F]{6}$/.test(themeColorRaw)
        ? themeColorRaw
        : '#10b981';
    // D1.2.2.6 — language. Whitelist 'th' / 'en'; everything else → 'th'.
    const languageRaw = await this.getKey('language');
    const language: 'th' | 'en' = languageRaw === 'en' ? 'en' : 'th';
    // D1.4.2.3 — cache_ttl_reports. Clamp to [30, 7200] seconds.
    const cacheTtlReportsRaw = await this.readNumber('cache_ttl_reports', 300);
    const cacheTtlReports =
      Number.isFinite(cacheTtlReportsRaw) && cacheTtlReportsRaw >= 30 && cacheTtlReportsRaw <= 7200
        ? Math.floor(cacheTtlReportsRaw)
        : 300;
    return {
      taxExemptWarningEnabled,
      reverseReasonRequired,
      reverseReasons,
      reverseManagerApprovalDays,
      paymentDateWarningBackdate,
      paymentDateAllowFuture,
      periodCloseDay,
      voucherShowQrCode,
      themeColor,
      language,
      cacheTtlReports,
    };
  }

  /**
   * Typed bundle of collections-session tuning knobs. Defaults match the
   * pre-Phase-2 hardcoded constants so first-boot behaviour is unchanged
   * even if the SystemConfig rows haven't been seeded yet.
   */
  async getCollectionsConfig(): Promise<{
    dailyCap: number;
    workloadFloor: number;
    etaPerContractMin: number;
    sessionTargetMin: number;
    selfClaimLockHours: number;
  }> {
    const dailyCap = await this.readNumber('collections.dailyCap', 30);
    const workloadFloor = await this.readNumber('collections.workloadFloor', 10);
    const etaPerContractMin = await this.readNumber('collections.etaPerContractMin', 5);
    const sessionTargetMin = await this.readNumber('collections.sessionTargetMin', 150);
    const selfClaimLockHours = await this.readNumber('collections.selfClaimLockHours', 2);
    return { dailyCap, workloadFloor, etaPerContractMin, sessionTargetMin, selfClaimLockHours };
  }

  async bulkUpdate(items: { key: string; value: string }[], userId?: string) {
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
