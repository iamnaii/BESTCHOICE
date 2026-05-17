import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { readBoolFlag, readNumberFlag } from '../../utils/config.util';

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

  // Delegate to shared util — keeps parsing semantics identical across services.
  private async readNumber(key: string, fallback: number): Promise<number> {
    return readNumberFlag(this.prisma, key, fallback);
  }

  private async readBoolean(key: string, fallback: boolean): Promise<boolean> {
    return readBoolFlag(this.prisma, key, fallback);
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
     * D1.2.3.4 — default number of decimal places for the generic number
     * formatter. Integer 0-4 inclusive. Default 2 (Thai currency convention).
     * SystemConfig key `decimal_places`. Out-of-range/non-integer values
     * clamp to default. The pref is the *default only* — `formatNumberDecimal`
     * call sites that explicitly pass a digit count continue to work as
     * before, preserving backwards compat.
     */
    decimalPlaces: number;
     * D1.2.3.3 — date display format toggle: 'BE' = Buddhist Era (พ.ศ., +543)
     * default, 'CE' = Christian/Common Era (Gregorian ค.ศ.). SystemConfig
     * key `date_format`. Applies to the *generic* `formatDateShort` family
     * in `apps/web/src/utils/formatters.ts`. Voucher-specific helpers
     * (`formatThaiDate*` in `apps/web/src/lib/date.ts`) remain BE-only by
     * design — legal/tax documents always show พ.ศ. regardless of UI pref.
     */
    dateFormat: 'BE' | 'CE';
    /**
     * D1.2.1.1 — Approval Workflow opt-in toggle. Default `false` (legacy
     * lifecycle DRAFT → POSTED is preserved). When `true`, expense docs
     * follow DRAFT → PENDING_APPROVAL → APPROVED → POSTED. The submit /
     * approve actions live on `ExpenseDocumentsService.submitForApproval()`
     * + `.approve()` (D1.2.1.6). Threshold + doc-type filters are layered
     * on top by D1.2.1.2 / D1.2.1.4. Web UI uses this flag to conditionally
     * render the "ส่งขออนุมัติ" button instead of "Post".
     */
    approvalEnabled: boolean;
    /**
     * D1.2.3.2 — default pagination size for list pages. Valid integer 10-200
     * inclusive. Default `50`. Out-of-range or non-numeric values clamp to
     * the default so a malformed admin edit can't break list pages. SystemConfig
     * key `pagination_size`. Frontend uses this as the default `limit` query
     * param; URL `?size=N` overrides per-session, but new sessions start at
     * this value.
     */
    paginationSize: number;
    /**
     * D1.2.3.1 — default time range preset selected on list-page mount.
     * Whitelisted: `'all' | 'this_month' | 'last_month'`. Default
     * `'this_month'` (matches accounting workflow expectation). Page-level
     * code uses this to initialize startDate/endDate when no URL query
     * params override; user changes mid-session are NOT persisted to the
     * setting — this is the *initial* state only.
     */
    defaultTimeRange: 'all' | 'this_month' | 'last_month';
    /**
     * D1.3.1.2 — AP-due alerts cron toggle. Default `false` (OFF) until
     * ExpenseDocument has a real `dueDate` column — currently the cron uses
     * `documentDate` as a proxy, so leaving it ON by default would spam
     * approvers with daily alerts for every POSTED doc 3+ days old regardless
     * of actual vendor credit terms. OWNERs opt-in via /settings when they
     * accept the documentDate semantics.
     */
    apDueAlertsEnabled: boolean;
    /**
     * D1.3.1.2 — number of days past `documentDate` that a POSTED unpaid
     * expense doc must reach before triggering an AP-due alert. Default 3.
     * NOTE: ExpenseDocument has no explicit dueDate column today; the cron
     * approximates "due in N days" by counting days since `documentDate`.
     */
    apDueDaysBefore: number;
    /**
     * D1.3.1.1 — DRAFT alerts toggle. When true, `DraftAlertsCron` (daily at
     * 09:00 BKK) scans expense docs in DRAFT for longer than the configured
     * threshold and sends an in-app notification to the creator. Default
     * `false` (opt-in) so existing deploys don't suddenly start spamming
     * users when this PR rolls out.
     */
    draftAlertsEnabled: boolean;
    /**
     * D1.3.1.1 — DRAFT alert threshold in days. Drafts older than this trigger
     * the alert. Default 7. Validated `> 0`.
     */
    draftAlertThresholdDays: number;
    /**
     * D1.1.6 — adjustment account codes for the V4 multi-line Adjustment
     * row. Frontend `AdjustmentSection.tsx` previously hardcoded
     * '52-1104' / '53-1503'; now reads from this flag so OWNER can rebind
     * the codes (e.g. branch-specific CoA variant) without a frontend
     * deploy. Defaults preserve the legacy behaviour.
     *
     * `underpay` is suggested when amountPaid < expected (Dr side).
     * `overpay` is suggested when amountPaid > expected (Cr side).
     *
     * Backend JE templates (PaymentReceipt2BTemplate, etc.) still
     * hardcode these codes — keeping this scoped to the V4 form so
     * server-side templates stay deterministic for golden CSV.
     */
    adjustmentCodes: { underpay: string; overpay: string };
    /**
     * D1.4.1.1 — BOOTSTRAP default for sidebar collapse on a brand-new device
     * (no `sidebar_collapse` key in localStorage). Once the user toggles the
     * sidebar in the UI, their personal preference is persisted and takes
     * precedence — this flag never overrides an existing per-user value.
     * Default false (= expanded). OWNER stores 'true' / 'false'.
     */
    sidebarCollapsedDefault: boolean;
    /**
     * D1.4.1.2 — controls whether keyboard-shortcut hints (the Shift+? help
     * dialog binding + per-item kbd hints) are exposed to the user. Default
     * true preserves the existing UX. OWNER stores 'true'/'false'.
     */
    showKeyboardShortcuts: boolean;
    /**
     * D1.4.1.3 — global animations + transitions toggle. Default true.
     * When false, the web app sets `data-animations-disabled="true"` on
     * `<html>` and a CSS rule strips `transition` / `animation` properties.
     * Complements the OS-level `prefers-reduced-motion` media query for
     * accessibility users on browsers that don't expose the OS setting.
     */
    animationEnabled: boolean;
    /**
     * D1.4.1.4 — BOOTSTRAP default theme for first-time devices (no `theme`
     * key in localStorage from next-themes). 'system' default = respect OS
     * `prefers-color-scheme`. Existing per-user preference always wins after
     * the user has clicked the theme toggle once.
     */
    darkModeDefault: 'light' | 'dark' | 'system';
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
    // D1.2.3.4 — decimal_places. Integer 0-4 inclusive; clamp to 2 default
    // for out-of-range / non-integer values.
    const decimalPlacesRaw = await this.readNumber('decimal_places', 2);
    const decimalPlaces =
      Number.isInteger(decimalPlacesRaw) && decimalPlacesRaw >= 0 && decimalPlacesRaw <= 4
        ? decimalPlacesRaw
        : 2;
    // D1.2.3.3 — date_format. Whitelist 'BE' / 'CE'; everything else → 'BE'.
    // Default 'BE' so existing flows are unchanged.
    const dateFormatRaw = await this.getKey('date_format');
    const dateFormat: 'BE' | 'CE' = dateFormatRaw === 'CE' ? 'CE' : 'BE';
    // D1.2.1.1 — Approval Workflow opt-in. Default true per
    // Settings_Audit_Core_v2.0.md spec. Owner can flip to `false` via
    // SystemConfig if rollout needs to be gradual.
    const approvalEnabled = await this.readBoolean('approval_enabled', true);
    // D1.2.3.2 — pagination_size. Integer 10-200 inclusive; clamp to 50
    // default for out-of-range or non-numeric values so list pages remain
    // usable even when SystemConfig is mis-edited.
    const paginationSizeRaw = await this.readNumber('pagination_size', 50);
    const paginationSize =
      Number.isInteger(paginationSizeRaw) && paginationSizeRaw >= 10 && paginationSizeRaw <= 200
        ? paginationSizeRaw
        : 50;
    // D1.2.3.1 — default time range. Whitelist; everything else falls
    // through to 'this_month' so a malformed admin edit can't break list
    // pages that depend on this for initial state.
    const defaultTimeRangeRaw = await this.getKey('default_time_range');
    const defaultTimeRange: 'all' | 'this_month' | 'last_month' =
      defaultTimeRangeRaw === 'all' || defaultTimeRangeRaw === 'last_month'
        ? defaultTimeRangeRaw
        : 'this_month';
    // D1.3.1.2 — AP-due alerts. Default OFF until ExpenseDocument has a real
    // dueDate column (documentDate proxy would otherwise spam every POSTED doc).
    const apDueAlertsEnabled = await this.readBoolean('ap_due_alerts_enabled', false);
    const apDueDaysBeforeRaw = await this.readNumber('ap_due_days_before', 3);
    const apDueDaysBefore = apDueDaysBeforeRaw >= 0 ? apDueDaysBeforeRaw : 3;
    // D1.3.1.1 — DRAFT alerts (opt-in, default off).
    const draftAlertsEnabled = await this.readBoolean('draft_alerts_enabled', false);
    const draftAlertThresholdDaysRaw = await this.readNumber(
      'draft_alert_threshold_days',
      7,
    );
    const draftAlertThresholdDays =
      draftAlertThresholdDaysRaw > 0 ? draftAlertThresholdDaysRaw : 7;
    // D1.1.6 — adjustment codes for the V4 form's manual reconciliation
    // row. Codes must match the format `\d{2}-\d{4}` to be accepted;
    // anything malformed falls back to the legacy default. Empty string
    // never returned — defensive against half-saved SystemConfig rows.
    const isValidCode = (raw: string | null): raw is string =>
      !!raw && /^\d{2}-\d{4}$/.test(raw);
    const underpayRaw = await this.getKey('adjustment_code_underpay');
    const overpayRaw = await this.getKey('adjustment_code_overpay');
    const adjustmentCodes = {
      underpay: isValidCode(underpayRaw) ? underpayRaw : '52-1104',
      overpay: isValidCode(overpayRaw) ? overpayRaw : '53-1503',
    };
    // D1.4.1.1 — sidebar bootstrap default. `readBoolean` already whitelists
    // 'true' / 'false' / '1' / '0' so a bad row falls back to false (expanded).
    const sidebarCollapsedDefault = await this.readBoolean(
      'sidebar_collapsed_default',
      false,
    );
    // D1.4.1.2 — keyboard shortcut hints + help-dialog binding. Default true.
    const showKeyboardShortcuts = await this.readBoolean(
      'show_keyboard_shortcuts',
      true,
    );
    // D1.4.1.3 — animation enabled. Default true.
    const animationEnabled = await this.readBoolean('animation_enabled', true);
    // D1.4.1.4 — dark_mode_default. Whitelist light/dark/system, default system.
    const darkModeDefaultRaw = await this.getKey('dark_mode_default');
    const darkModeDefault: 'light' | 'dark' | 'system' =
      darkModeDefaultRaw === 'light' || darkModeDefaultRaw === 'dark'
        ? darkModeDefaultRaw
        : 'system';
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
      decimalPlaces,
      dateFormat,
      approvalEnabled,
      paginationSize,
      defaultTimeRange,
      apDueAlertsEnabled,
      apDueDaysBefore,
      draftAlertsEnabled,
      draftAlertThresholdDays,
      adjustmentCodes,
      sidebarCollapsedDefault,
      showKeyboardShortcuts,
      animationEnabled,
      darkModeDefault,
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

  async bulkUpdate(items: { key: string; value: string }[], userId?: string) {
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
