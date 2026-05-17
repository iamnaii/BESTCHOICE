import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { readBoolFlag, readNumberFlag } from '../../utils/config.util';
import { SSO_RATE } from '../sso-config/sso-config.service';

/**
 * D1.1.3.3 — keys that are exposed read-only through SystemConfig.
 * Writes via update/bulkUpdate are rejected with BadRequestException.
 * `sso_rate_locked` is informational ("5%" string) because Thai SSO Act
 * §46 + the ministerial regulation issued under it fix the contribution
 * rate at 5%; UI displays it so OWNER understands the value is non-editable.
 */
const READ_ONLY_KEYS = new Set<string>(['sso_rate_locked']);

/**
 * D1.1.5.5 — Whitelist of UserRoles that may hold the Petty Cash custodian
 * seat. The active role is read from SystemConfig key
 * `petty_cash_custodian_role` (default 'ACCOUNTANT'); only roles in this
 * tuple are accepted as the configured value. Picking a non-whitelisted role
 * silently falls back to ACCOUNTANT.
 */
const PETTY_CASH_CUSTODIAN_ROLES = ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
type PettyCashCustodianRole = (typeof PETTY_CASH_CUSTODIAN_ROLES)[number];

/**
 * D1.1.2.1 — default mapping from DocumentType → 2-4 letter prefix. Mirrors the
 * pre-Phase-2 hardcoded PREFIX_MAP in `DocNumberService` and serves as the
 * fallback when SystemConfig key `doc_prefix_per_type` is missing or malformed.
 * Keep keys in sync with the `DocumentType` enum in `schema.prisma`.
 */
export const DEFAULT_DOC_PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
  PETTY_CASH_REIMBURSEMENT: 'PC',
};

/** Validation regex — 2 to 4 uppercase Latin letters. Mirrors A-Z constraint
 *  used by downstream JE templates + spreadsheet parsers. */
export const DOC_PREFIX_REGEX = /^[A-Z]{2,4}$/;

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
  }

  /**
   * Single key update with audit trail. Callers must pass userId — passing
   * null/undefined skips the audit log and is reserved for system-internal
   * writes (e.g. automated migrations).
   */
  async update(key: string, value: string, userId?: string) {
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
   * D1.3.3.1 — public accessor for the export-enabled flag, used by export
   * endpoints (PDF receipts, trade-in vouchers, OI receipt, reporting PDF)
   * to short-circuit with 403 before any heavy generation happens. Defaults
   * to true so existing exports keep working when the SystemConfig row is
   * absent (first-boot / fresh-DB).
   */
  async isExportEnabled(): Promise<boolean> {
    return this.readBoolean('export_enabled', true);
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
   * D1.1.3.2 — DB-driven WHT-rate dropdown. JSON-encoded array of
   * `{rate, label}` objects stored in SystemConfig key `wht_rates`.
   * Default = the 5 canonical rates (1/3/5/10/15 %).
   *
   * D1.1.3.5 — each entry MAY also carry an optional `effectiveDate`
   * (ISO-8601 string). `null`/missing means "always active". Frontend
   * filters out future-dated entries client-side when rendering the
   * dropdown. The server keeps stored history intact.
   *
   * Validation rules per entry:
   *   - `rate` must be a finite number in [0, 30]
   *   - `label` must be a non-empty string
   *   - `effectiveDate`, if present, must be a string that parses to a
   *     valid Date (Date.parse not NaN)
   * If ANY entry fails validation, fall back to defaults wholesale —
   * partial/malformed data leaks confusing UI options.
   */
  async getWhtRates(): Promise<
    { rate: number; label: string; effectiveDate?: string | null }[]
  > {
    const raw = await this.getKey('wht_rates');
    const defaults: { rate: number; label: string; effectiveDate?: string | null }[] = [
      { rate: 1, label: '1% — ดอกเบี้ย' },
      { rate: 3, label: '3% — ค่าบริการ' },
      { rate: 5, label: '5% — ค่าเช่า' },
      { rate: 10, label: '10% — ค่าวิชาชีพ' },
      { rate: 15, label: '15% — ต่างประเทศ' },
    ];
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every(
          (r) =>
            r &&
            typeof r === 'object' &&
            typeof r.rate === 'number' &&
            Number.isFinite(r.rate) &&
            r.rate >= 0 &&
            r.rate <= 30 &&
            typeof r.label === 'string' &&
            r.label.trim().length > 0 &&
            // effectiveDate is optional — null/undefined or a parsable string.
            (r.effectiveDate == null ||
              (typeof r.effectiveDate === 'string' &&
                !Number.isNaN(Date.parse(r.effectiveDate)))),
        )
      ) {
        return defaults;
      }
      // Normalize: drop unknown keys, coerce effectiveDate to string|null.
      return parsed.map((r) => ({
        rate: r.rate,
        label: r.label,
        ...(r.effectiveDate ? { effectiveDate: r.effectiveDate as string } : {}),
      }));
    } catch {
      return defaults;
    }
  }

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

  /**
   * D1.1.2.1 — DocumentType → prefix mapping. Reads SystemConfig key
   * `doc_prefix_per_type` (JSON object). Falls back to `DEFAULT_DOC_PREFIX_MAP`
   * when the key is missing, malformed, or any value fails the
   * `DOC_PREFIX_REGEX` (2-4 uppercase Latin letters).
   *
   * Partial overrides are supported: a stored `{ "EXPENSE": "EXP" }` overrides
   * the EXPENSE prefix and falls back to defaults for every other type.
   *
   * **Safety**: invalid stored values do NOT throw at read time — they're
   * silently replaced with the default so doc creation never blocks on a bad
   * SystemConfig row. The validation guard in `bulkUpdate` rejects malformed
   * values at write time.
   */
  async getDocPrefixMap(): Promise<Record<DocumentType, string>> {
    const raw = await this.getKey('doc_prefix_per_type');
    if (!raw) return { ...DEFAULT_DOC_PREFIX_MAP };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...DEFAULT_DOC_PREFIX_MAP };
      }
      const result: Record<DocumentType, string> = { ...DEFAULT_DOC_PREFIX_MAP };
      for (const key of Object.keys(DEFAULT_DOC_PREFIX_MAP) as DocumentType[]) {
        const candidate = (parsed as Record<string, unknown>)[key];
        if (typeof candidate === 'string' && DOC_PREFIX_REGEX.test(candidate)) {
          result[key] = candidate;
        }
      }
      return result;
    } catch {
      return { ...DEFAULT_DOC_PREFIX_MAP };
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
     * D1.1.2.1 — DocumentType → 2-4 letter prefix mapping. Used by the UI to
     * render document number badges (e.g. show "EX" next to an EXPENSE doc).
     * Always returns the full default mapping when no override is configured.
     */
    docPrefixMap: Record<DocumentType, string>;
    /**
     * D1.3.3.2 — bank reconciliation mode. Whitelisted `'manual'` / `'auto'`,
     * default `'manual'`. Currently INFORMATIONAL only: the auto-match cron
     * + UI to drive it haven't been built yet. When `'auto'`, a future cron
     * will read bank statements (PaySolutions webhook + KBank/SCB CSV) and
     * auto-link to Payment.depositAccountCode entries with matching amount
     * + 1d-tolerance datetime. Current code path = the existing manual link
     * via PaymentForm. OWNER setting this to `'auto'` today shows an
     * "auto-match mode" indicator on any bank-reconciliation UI but does
     * not change behaviour.
     */
    bankReconciliationMode: 'manual' | 'auto';
    /**
     * D1.1.3.3 — informational "SSO rate is locked at 5%" string for the
     * Settings UI to display. Computed from `SSO_RATE` constant, NOT from
     * SystemConfig — that key is read-only (writes rejected by service).
     */
    ssoRateLocked: string;
    /**
     * D1.3.6.2 — default-tick preference for the SettlementLinesSection bill
     * list. Whitelist of three modes:
     *   - `'all'`            — every fetched bill pre-ticked
     *   - `'none'`           — nothing pre-ticked (manual selection only)
     *   - `'overdue_only'`   — only bills past their `documentDate`-derived
     *                          due date pre-ticked (default)
     * Anything outside the whitelist (mis-edit, legacy value, malformed
     * string) falls back to `'overdue_only'`.
     */
    settlementDefaultTick: 'all' | 'none' | 'overdue_only';
    /**
     * D1.1.3.2 — configurable WHT-rate dropdown. Always at least the 5
     * defaults (1/3/5/10/15 %). Each entry may carry an optional
     * `effectiveDate` (D1.1.3.5) — frontend filters out future-dated
     * entries when rendering the picker.
     */
    whtRates: { rate: number; label: string; effectiveDate?: string | null }[];
    /**
     * D1.3.3.1 — global toggle for data-export endpoints (Excel/PDF/CSV).
     * Default true. When OWNER sets `export_enabled = 'false'`, the server
     * blocks PDF export endpoints with HTTP 403 and the web hides the
     * "ส่งออก Excel" / "ดาวน์โหลด PDF" buttons. Useful for compliance
     * lockdown periods (e.g. statutory audit window) where uncontrolled
     * data extraction needs to be paused.
     */
    exportEnabled: boolean;
    /**
     * D1.4.3.2 — gate the weekly audit-log archive sweep
     * (`AuditRetentionCron.archiveOldEntries`). Default `true`. When `false`,
     * the cron skips without touching rows. Hard-delete remains impossible
     * regardless (BEFORE DELETE trigger on audit_logs), so flipping this off
     * just keeps rows in the hot set rather than purging the legal trail.
     */
    auditLogArchiveEnabled: boolean;
    /**
     * D1.4.3.3 — legal document retention period in years. Default 5 per
     * พ.ร.บ.การบัญชี พ.ศ. 2543 ม.7 (Thai Accounting Act §7). Validated 1–30
     * and clamped on read so an out-of-range SystemConfig row can't surface
     * absurd values downstream.
     *
     * Currently INFORMATIONAL only — there is no automated purge cron for
     * expense / sales / receipt documents yet. The value is exposed so the
     * compliance UI can display the configured retention policy. Future
     * implementation gating any document purge (or archival) on this value
     * should call `getUiFlags()` rather than re-reading the SystemConfig
     * row directly.
     */
    documentRetentionYears: number;
    /**
     * D1.4.2.4 — batch size for CSV row processing in bulk imports.
     * Default 500, valid 50–5000 (clamped). Currently INFORMATIONAL —
     * the Payments CSV import in `payments.service.ts` processes rows
     * one-at-a-time in a `for` loop (no explicit batching), so this flag
     * is exposed for future bulk-import paths. The numeric range is
     * deliberately wide so OWNER can dial down for resource-constrained
     * deploys or up for high-throughput imports. Originally SKIP per
     * Phase 2; shipped per owner directive 2026-05-17 to reach 100% A1.
     */
    batchSizeImport: number;
    /**
     * D1.4.3.4 — preferred format for data export / compliance backup.
     * Whitelist `'JSON'` / `'CSV'` / `'XLSX'`, default `'JSON'`. Existing
     * export buttons across the app should select this as the DEFAULT
     * option in their format dropdown; the user can still override per
     * export. Future automated compliance-backup jobs should consume
     * this value via `getUiFlags()` rather than re-reading the
     * SystemConfig row directly.
     */
    dataExportFormat: 'JSON' | 'CSV' | 'XLSX';
    /**
     * D1.4.3.5 — master PII masking toggle (PDPA policy surface).
     * Default `true`. Currently INFORMATIONAL — existing PII masking
     * helpers (`maskPhone`, `maskNationalId`, `maskEmail`, `maskBankAccount`)
     * are consumed per-call in role-aware controllers and do NOT consult
     * this flag. Surfacing it lets the admin UI display the PDPA stance
     * and surface a bold warning before persisting `false`.
     */
    piiMaskingEnabled: boolean;
    /**
     * D1.4.2.5 — max concurrent BullMQ worker jobs. Default 5, valid 1–50
     * (clamped). Currently INFORMATIONAL for the SystemConfig key — the
     * BullMQ `@Processor` decorator is evaluated at class load time and
     * cannot read a DB-backed value at boot. The flag is exposed so OWNER
     * can advertise the intended concurrency cap; the actual worker
     * concurrency is set via `MAX_CONCURRENT_JOBS` env var read in
     * `NotificationWorker`'s @Processor options (same default 5). A future
     * refactor can wire this to a hot-reloadable dispatcher.
     */
    maxConcurrentJobs: number;
    /**
     * D1.4.3.6 — gate the LoginAuditLog row INSERT in
     * `LoginAuditService.record`. Default `true`. When `false`, no audit
     * row is written for login attempts — known-device tracking +
     * new-device LINE alerts still run (security alerting independent of
     * audit retention) and failed-attempt counting + account lockout in
     * `AuthService` are unaffected (those drive the v3 account-lockout
     * hardening, NOT the audit trail).
     */
    loginLogEnabled: boolean;
    /**
     * D1.3.4.2 — days threshold for the SAMEDAY→ACCRUAL auto-switch.
     * Default `0` = any past document date triggers the flip (preserves
     * the pre-Phase-4 hardcoded behavior). When set to N>0, the flip only
     * fires when `(today − documentDate) > N` days. Useful when the shop
     * routinely books cash purchases the next day (set `1` to tolerate a
     * one-day lag without flipping to ACCRUAL). Clamped to 0–30 on read;
     * non-integer / NaN / negative values fall back to 0.
     *
     * Originally marked SKIP per Phase 2 decision report; shipped per
     * owner directive 2026-05-17 to reach 100% A1 coverage.
     */
    smartSwitchThresholdDays: number;
    /**
     * D1.3.4.1 — gate the auto SAMEDAY→ACCRUAL switch logic in the expense
     * entry form. Default `true` preserves the existing one-way auto-flip
     * (ExpenseFormV4: when the user picks a past `documentDate` while
     * docType is SAMEDAY, flip to ACCRUAL). When `false` the auto-flip is
     * skipped and the user must manually pick SAMEDAY vs ACCRUAL — useful
     * for accountants who explicitly want SAMEDAY entries with a backdated
     * invoice (e.g. cash purchases booked next day).
     *
     * Originally marked SKIP per Phase 2 decision report; shipped per
     * owner directive 2026-05-17 to reach 100% A1 coverage.
     */
    smartDoctypeSwitchEnabled: boolean;
    /**
     * D1.1.6.3 — auto-route the ≤1฿ rounding remainder on Payment receipts
     * to adj_underpay (52-1104) / adj_overpay (53-1503). Default TRUE.
     * When FALSE, PaymentReceipt2B + PaymentReceipt2B-split throw
     * BadRequestException on any non-zero rounding diff, forcing a manual
     * JV to clear the residual. Exposed here so the admin Settings UI can
     * render the toggle; the actual server-side enforcement lives in the JE
     * templates (they read `adj_auto_route` directly via PrismaService).
     */
    adjAutoRoute: boolean;
    /**
     * D1.3.6.1 — max number of bills (cleared docs) per VENDOR_SETTLEMENT
     * document. Default 100 (matches the legacy `limit=100` literal that
     * `SettlementLinesSection.tsx` used to pull from `/expense-documents`).
     * Clamped to 1–500 on read so an OWNER mis-edit can't disable the cap or
     * blow up the SE form. Server enforces the cap on `createSettlement()`;
     * UI uses the value to surface an early-warning banner before submit.
     */
    settlementMaxBillsPerDoc: number;
    /**
     * D1.1.5.4 — Petty Cash replenish alert threshold (THB). Default 5000,
     * valid 0–50000 (clamp). When the running float balance falls below this
     * number, `PettyCashReplenishAlertCron` (daily 09:00 BKK) notifies all
     * active OWNERs via IN_APP. Setting to 0 disables the alert entirely
     * (kill switch — owner can pick "dead" semantics by flipping this to 0).
     */
    pettyCashReplenishThreshold: number;
    /**
     * D1.1.5.1 — Petty Cash feature flag. Default true (feature is shipped
     * and active per PRs #867+#868). When OWNER sets `petty_cash_enabled=false`,
     * the web UI hides the Petty Cash doc-type card + the section in
     * ExpenseFormV4, and the backend `createPettyCash` rejects with BadRequest
     * "ระบบเงินสดย่อยถูกปิดใช้งาน".
     */
    pettyCashEnabled: boolean;
    /**
     * D1.2.5.3 — render the 3-column partial-payment breakdown (ยอดเดิม /
     * ยอดที่ชำระ / ยอดคงเหลือ) on the voucher. Default true. When false the
     * voucher shows only a single "ยอดที่ชำระ" column.
     */
    voucherShowPartialColumns: boolean;
    /**
     * D1.2.5.2 — include the rounding-adjustment / overpay-adjustment journal
     * lines (52-1104, 53-1503) in the **printable** voucher layout. Default
     * true. When false the rows are still rendered on screen so the JE
     * preview stays complete, but the print stylesheet hides them so the
     * physical paper voucher doesn't show the adjustment cents.
     */
    voucherIncludeAdjustment: boolean;
    /**
     * D1.2.5.1 — voucher print mode.
     *   - 'multi' (default) — emits BOTH the original (ต้นฉบับ) and the
     *     customer-copy (สำเนา) sheets, each on its own A4 page. The
     *     customer copy carries a "สำเนา" watermark in the header.
     *   - 'single' — renders only the original sheet.
     * Whitelisted; unknown values fall back to 'multi'.
     */
    voucherPrintMode: 'single' | 'multi';
    /**
     * D1.2.4.1 — global toggle for the Expense Templates feature. When false,
     * ExpenseTemplatesService rejects all writes (create/update/delete/
     * instantiate) with a 403 ForbiddenException, and the UI hides the
     * "บันทึกเป็นรายการโปรด" buttons + templates list. List/read endpoints
     * still resolve (so legacy data isn't hidden) but new writes are blocked.
     * Default true to preserve current behaviour.
     */
    templatesEnabled: boolean;
    /**
     * D1.2.4.2 — per-user quota of saved Expense Templates. Default 20.
     * Clamped to 1–1000 on read. `ExpenseTemplatesService.create` counts
     * the caller's existing (non-deleted) templates against this cap and
     * rejects with BadRequestException ("โควต้าเทมเพลตเต็มแล้ว — ลบ
     * เทมเพลตเก่าก่อนสร้างใหม่") when count >= cap. UI surfaces it as a
     * "X/N" badge on the favorites picker for at-a-glance awareness.
     */
    maxTemplatesPerUser: number;
    /**
     * D1.2.4.4 — gates the `{{variable}}` interpolation feature on
     * Expense Templates. Default true. When false, the UI hides the
     * "ใส่ตัวแปร" affordance and `interpolateTemplate()` callers should
     * skip interpolation. The util itself (`template-interpolation.util`)
     * is pure and always available; this flag controls whether the
     * product surfaces the feature to users.
     */
    templateVariablesEnabled: boolean;
    /**
     * D1.2.4.3 — default visibility for newly-created Expense Templates.
     * Whitelisted PRIVATE/TEAM/PUBLIC, default PRIVATE. The UI uses this
     * value to pre-select the visibility radio on the "บันทึกเป็นรายการ
     * โปรด" dialog. Server-side, `ExpenseTemplatesService.listTemplates`
     * filters rows by visibility: creator always sees own, TEAM viewers
     * see grants from `sharedWith`, PUBLIC visible to all authenticated
     * users (cross-branch access still gated by branchId).
     */
    templateSharingDefault: 'PRIVATE' | 'TEAM' | 'PUBLIC';
    /**
     * D1.2.3.5 — thousands separator style for the generic number formatter.
     * Whitelisted: 'comma' (1,234,567) default, 'space' (1 234 567), or
     * 'none' (1234567). SystemConfig key `thousands_separator`. Invalid
     * values fall back to 'comma'. Voucher-specific helpers in `lib/date.ts`
     * are unaffected — they format dates not numbers.
     */
    thousandsSeparator: 'comma' | 'space' | 'none';
    /**
     * D1.2.3.4 — default number of decimal places for the generic number
     * formatter. Integer 0-4 inclusive. Default 2 (Thai currency convention).
     * SystemConfig key `decimal_places`. Out-of-range/non-integer values
     * clamp to default. The pref is the *default only* — `formatNumberDecimal`
     * call sites that explicitly pass a digit count continue to work as
     * before, preserving backwards compat.
     */
    decimalPlaces: number;
    /**
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
     * D1.3.5.1 — default time range preset for the expense daily-summary
     * page. Whitelisted: `'today' | 'this_week' | 'this_month' | 'last_month'`.
     * Default `'this_month'`. Wider preset set than `defaultTimeRange` because
     * the summary page is consumed daily (operations) AND monthly (ผู้จัดการ
     * รีวิว). Page-level code uses this to initialize startDate/endDate on
     * mount; mid-session user changes are NOT persisted to the setting.
     */
    summaryDefaultRange: 'today' | 'this_week' | 'this_month' | 'last_month';
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
     * D1.3.1.4 — Master IN_APP notification kill switch. Default `true`.
     * When `false`, NotificationsService.send() returns
     * `{ id: '', status: 'SKIPPED', blockReason: 'IN_APP_DISABLED' }` for
     * `IN_APP` channel calls — no DB write, no exception. LINE/SMS unaffected.
     * Surfaced here so UIs can render banners explaining the silent skip.
     */
    inAppNotificationsEnabled: boolean;
    /**
     * D1.4.1.4 — BOOTSTRAP default theme for first-time devices (no `theme`
     * key in localStorage from next-themes). 'system' default = respect OS
     * `prefers-color-scheme`. Existing per-user preference always wins after
     * the user has clicked the theme toggle once.
     */
    darkModeDefault: 'light' | 'dark' | 'system';
    /**
     * D1.4.2.1 — long-running query timeout (seconds). Default 30, valid
     * range 5–300 (clamped). Currently INFORMATIONAL — applying this to
     * Postgres requires a DB-level `statement_timeout` setting, and the
     * shared axios client in `apps/web/src/lib/api.ts` uses a fixed 15s
     * timeout. The flag is exposed so OWNER can advertise the intended
     * cutoff to operators and a future PR can wire it into either the
     * axios `timeout` field or a Postgres `SET LOCAL statement_timeout`
     * pre-hook. Originally SKIP per Phase 2; shipped per owner directive
     * 2026-05-17 to reach 100% A1 coverage.
     */
    queryTimeoutSeconds: number;
    /**
     * D1.3.1.3 — active email provider. Whitelisted: 'smtp' (default —
     * uses SMTP_HOST/PORT/USER/PASS env vars) / 'sendgrid' (stub — owner
     * must wire SENDGRID_API_KEY before flipping). UI shows "Current
     * provider: SMTP / Sendgrid" + warns when SMTP env not configured.
     */
    emailProvider: 'smtp' | 'sendgrid';
    /**
     * D1.4.2.2 — react-query staleTime (seconds) for dashboard KPI / chart
     * queries. Default 60s, valid 10–3600 (clamped). Actively wired into
     * `DashboardPage`'s `dashboardStaleTime` so OWNER can balance
     * freshness vs DB cost without redeploy. Originally SKIP per Phase 2;
     * shipped per owner directive 2026-05-17 to reach 100% A1 coverage.
     */
    cacheTtlDashboard: number;
    /**
     * D1.4.2.3 — react-query staleTime (seconds) for aggregated report
     * queries (P&L, monthly P&L, trial balance). Default 300s, valid
     * 30–7200 (clamped). Wired into `ProfitLossPage`.
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
    // D1.1.2.1 — DocumentType → prefix map (defaults applied per type when
    // stored value is missing or malformed).
    const docPrefixMap = await this.getDocPrefixMap();
    // D1.3.3.2 — bank reconciliation mode. Whitelist 'manual' / 'auto'.
    const bankRecRaw = await this.getKey('bank_reconciliation');
    const bankReconciliationMode: 'manual' | 'auto' =
      bankRecRaw === 'auto' ? 'auto' : 'manual';
    // D1.1.3.3 — sso_rate is locked at 5% by Thai SSO Act §46 + the
    // ministerial regulation issued under it. Computed from the
    // source-of-truth SSO_RATE constant, never read from DB.
    const ssoRateLocked = `${(SSO_RATE * 100).toFixed(0)}%`;
    // D1.3.6.2 — settlement_default_tick. Whitelist 'all' / 'none' /
    // 'overdue_only'; everything else → 'overdue_only' (spec default).
    const settlementDefaultTickRaw = await this.getKey('settlement_default_tick');
    const settlementDefaultTick: 'all' | 'none' | 'overdue_only' =
      settlementDefaultTickRaw === 'all'
        ? 'all'
        : settlementDefaultTickRaw === 'none'
          ? 'none'
          : 'overdue_only';
    // D1.1.3.2 — WHT rates (default 5 canonical entries + optional D1.1.3.5
    // effectiveDate per entry).
    const whtRates = await this.getWhtRates();
    // D1.3.3.1 — export_enabled. Default true.
    const exportEnabled = await this.readBoolean('export_enabled', true);
    // D1.4.3.2 — audit log archive toggle. Default true.
    const auditLogArchiveEnabled = await this.readBoolean(
      'audit_log_archive_enabled',
      true,
    );
    // D1.4.3.3 — document retention years. Default 5 per พ.ร.บ.บัญชี ม.7.
    // Clamp to [1, 30] so an out-of-range row can't surface absurd values.
    const documentRetentionYearsRaw = await this.readNumber('document_retention_years', 5);
    const documentRetentionYears =
      Number.isInteger(documentRetentionYearsRaw) &&
      documentRetentionYearsRaw >= 1 &&
      documentRetentionYearsRaw <= 30
        ? documentRetentionYearsRaw
        : 5;
    // D1.4.2.4 — batch_size_import. Clamp to [50, 5000] rows.
    const batchSizeImportRaw = await this.readNumber('batch_size_import', 500);
    const batchSizeImport =
      Number.isFinite(batchSizeImportRaw) && batchSizeImportRaw >= 50 && batchSizeImportRaw <= 5000
        ? Math.floor(batchSizeImportRaw)
        : 500;
    // D1.4.3.4 — data_export_format. Whitelist JSON/CSV/XLSX; default JSON.
    const dataExportFormatRaw = await this.getKey('data_export_format');
    const dataExportFormat: 'JSON' | 'CSV' | 'XLSX' =
      dataExportFormatRaw === 'CSV' || dataExportFormatRaw === 'XLSX'
        ? dataExportFormatRaw
        : 'JSON';
    // D1.4.3.5 — pii_masking_enabled. Default true (PDPA policy surface).
    const piiMaskingEnabled = await this.readBoolean('pii_masking_enabled', true);
    // D1.4.2.5 — max_concurrent_jobs. Default 5, clamp 1–50.
    const maxConcurrentJobsRaw = await this.readNumber('max_concurrent_jobs', 5);
    const maxConcurrentJobs =
      Number.isInteger(maxConcurrentJobsRaw) &&
      maxConcurrentJobsRaw >= 1 &&
      maxConcurrentJobsRaw <= 50
        ? maxConcurrentJobsRaw
        : 5;
    // D1.4.3.6 — login_log_enabled. Default true.
    const loginLogEnabled = await this.readBoolean('login_log_enabled', true);
    // D1.3.4.2 — smart-switch threshold (days). Clamp 0–30; non-integer /
    // NaN / negative → 0. Default 0 = legacy behavior (any past date flips).
    const smartSwitchThresholdRaw = await this.readNumber(
      'smart_switch_threshold_days',
      0,
    );
    const smartSwitchThresholdDays =
      Number.isInteger(smartSwitchThresholdRaw) &&
      smartSwitchThresholdRaw >= 0 &&
      smartSwitchThresholdRaw <= 30
        ? smartSwitchThresholdRaw
        : 0;
    // D1.3.4.1 — smart_doctype_switch_enabled (default true).
    const smartDoctypeSwitchEnabled = await this.readBoolean(
      'smart_doctype_switch_enabled',
      true,
    );
    // D1.1.6.3 — adj_auto_route. Defaults TRUE so first-boot behaviour
    // mirrors the original auto-route-to-52-1104/53-1503 logic.
    const adjAutoRoute = await this.readBoolean('adj_auto_route', true);
    // D1.3.6.1 — settlement_max_bills_per_doc. Clamp to 1–500 inclusive;
    // anything outside (incl. NaN / negative) falls back to the default 100
    // which matches the previous hardcoded limit.
    const settlementMaxBillsRaw = await this.readNumber('settlement_max_bills_per_doc', 100);
    const settlementMaxBillsPerDoc =
      Number.isInteger(settlementMaxBillsRaw) &&
      settlementMaxBillsRaw >= 1 &&
      settlementMaxBillsRaw <= 500
        ? settlementMaxBillsRaw
        : 100;
    // D1.1.5.4 — Petty Cash replenish threshold. Default 5000, valid 0–50000.
    // Negative or NaN silently clamps to default 5000 so a bad SystemConfig
    // row can't accidentally suppress the alert via negative comparison.
    const thresholdRaw = await this.readNumber('petty_cash_replenish_threshold', 5000);
    let pettyCashReplenishThreshold = thresholdRaw;
    if (!Number.isFinite(pettyCashReplenishThreshold) || pettyCashReplenishThreshold < 0) {
      pettyCashReplenishThreshold = 5000;
    } else if (pettyCashReplenishThreshold > 50000) {
      pettyCashReplenishThreshold = 50000;
    }
    // D1.1.5.1 — Petty Cash feature flag. Default true (feature shipped).
    const pettyCashEnabled = await this.readBoolean('petty_cash_enabled', true);
    // D1.2.5.3 — show ยอดเดิม / ยอดที่ชำระ / ยอดคงเหลือ on voucher.
    const voucherShowPartialColumns = await this.readBoolean(
      'voucher_show_partial_columns',
      true,
    );
    // D1.2.5.2 — include adjustment rows (52-1104 / 53-1503) on printed voucher.
    const voucherIncludeAdjustment = await this.readBoolean(
      'voucher_include_adjustment',
      true,
    );
    // D1.2.5.1 — voucher print mode. Whitelist 'single' / 'multi'; default 'multi'.
    const voucherPrintModeRaw = await this.getKey('voucher_print_mode_default');
    const voucherPrintMode: 'single' | 'multi' =
      voucherPrintModeRaw === 'single' ? 'single' : 'multi';
    // D1.2.4.1 — Expense Templates feature flag.
    const templatesEnabled = await this.readBoolean('templates_enabled', true);
    // D1.2.4.2 — per-user template quota. Clamp to 1–1000 (same range as
    // ExpenseTemplatesService's internal cap-reader so values stay aligned).
    // D1.2.4.4 — gate the {{variable}} interpolation surface. Default true.
    const templateVariablesEnabled = await this.readBoolean(
      'template_variables_enabled',
      true,
    );
    // D1.2.4.3 — template sharing default. Whitelist PRIVATE/TEAM/PUBLIC;
    // any unknown value falls back to PRIVATE (safest — never accidentally
    // expose a new template to the whole shop on a bad config write).
    const sharingRaw = await this.getKey('template_sharing_default');
    const templateSharingDefault: 'PRIVATE' | 'TEAM' | 'PUBLIC' =
      sharingRaw === 'TEAM' || sharingRaw === 'PUBLIC' ? sharingRaw : 'PRIVATE';
    // D1.2.4.2 — per-user template quota. Default 20, clamp to 1–1000 on
    // read so a bad SystemConfig row can't disable the cap (which would
    // let one user balloon the favorites table) or pin it to 0 (which
    // would lock everyone out of saving new templates).
    const maxTemplatesPerUserRaw = await this.readNumber('max_templates_per_user', 20);
    const maxTemplatesPerUser =
      Number.isFinite(maxTemplatesPerUserRaw) && maxTemplatesPerUserRaw >= 1
        ? Math.min(Math.floor(maxTemplatesPerUserRaw), 1000)
        : 20;
    // D1.2.3.5 — thousands_separator. Whitelist 'comma' / 'space' / 'none';
    // everything else → 'comma'.
    const tsRaw = await this.getKey('thousands_separator');
    const thousandsSeparator: 'comma' | 'space' | 'none' =
      tsRaw === 'space' || tsRaw === 'none' ? tsRaw : 'comma';
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
    // D1.3.5.1 — summary-page default range. Wider whitelist than
    // defaultTimeRange (no 'all' — summary always wants a bounded period,
    // and the page UI doesn't currently expose an "all" option; the
    // companion D1.3.5.2 banner explains gracefully if 'all' is ever wired).
    const summaryDefaultRangeRaw = await this.getKey('summary_default_range');
    const summaryDefaultRange: 'today' | 'this_week' | 'this_month' | 'last_month' =
      summaryDefaultRangeRaw === 'today' ||
      summaryDefaultRangeRaw === 'this_week' ||
      summaryDefaultRangeRaw === 'last_month'
        ? summaryDefaultRangeRaw
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
    // D1.3.1.4 — Master IN_APP notification toggle. Default true.
    const inAppNotificationsEnabled = await this.readBoolean(
      'in_app_notifications_enabled',
      true,
    );
    // D1.4.1.4 — dark_mode_default. Whitelist light/dark/system, default system.
    const darkModeDefaultRaw = await this.getKey('dark_mode_default');
    const darkModeDefault: 'light' | 'dark' | 'system' =
      darkModeDefaultRaw === 'light' || darkModeDefaultRaw === 'dark'
        ? darkModeDefaultRaw
        : 'system';
    // D1.4.2.1 — query_timeout_seconds. Clamp to [5, 300].
    const queryTimeoutSecondsRaw = await this.readNumber('query_timeout_seconds', 30);
    const queryTimeoutSeconds =
      Number.isFinite(queryTimeoutSecondsRaw) && queryTimeoutSecondsRaw >= 5 && queryTimeoutSecondsRaw <= 300
        ? Math.floor(queryTimeoutSecondsRaw)
        : 30;
    // D1.3.1.3 — email provider whitelist. Default smtp.
    const emailProviderRaw = await this.getKey('email_provider');
    const emailProvider: 'smtp' | 'sendgrid' =
      emailProviderRaw === 'sendgrid' ? 'sendgrid' : 'smtp';
    // D1.4.2.2 — cache_ttl_dashboard. Clamp to [10, 3600] seconds.
    const cacheTtlDashboardRaw = await this.readNumber('cache_ttl_dashboard', 60);
    const cacheTtlDashboard =
      Number.isFinite(cacheTtlDashboardRaw) && cacheTtlDashboardRaw >= 10 && cacheTtlDashboardRaw <= 3600
        ? Math.floor(cacheTtlDashboardRaw)
        : 60;
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
      docPrefixMap,
      bankReconciliationMode,
      ssoRateLocked,
      settlementDefaultTick,
      whtRates,
      exportEnabled,
      auditLogArchiveEnabled,
      documentRetentionYears,
      batchSizeImport,
      dataExportFormat,
      piiMaskingEnabled,
      maxConcurrentJobs,
      loginLogEnabled,
      smartSwitchThresholdDays,
      summaryDefaultRange,
      smartDoctypeSwitchEnabled,
      adjAutoRoute,
      settlementMaxBillsPerDoc,
      pettyCashReplenishThreshold,
      pettyCashEnabled,
      voucherShowPartialColumns,
      voucherIncludeAdjustment,
      voucherPrintMode,
      templatesEnabled,
      maxTemplatesPerUser,
      templateVariablesEnabled,
      templateSharingDefault,
      thousandsSeparator,
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
      inAppNotificationsEnabled,
      darkModeDefault,
      queryTimeoutSeconds,
      emailProvider,
      cacheTtlDashboard,
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

  // ─── D1.1.5.5 — Petty Cash custodian (FK on CompanyInfo) ────────────

  /**
   * Returns the effective custodian role (whitelisted; falls back to default).
   * Used both by the assign endpoint validation and by the UI picker filter.
   */
  async getPettyCashCustodianRole(): Promise<PettyCashCustodianRole> {
    const raw = await this.getKey('petty_cash_custodian_role');
    if (raw && (PETTY_CASH_CUSTODIAN_ROLES as readonly string[]).includes(raw)) {
      return raw as PettyCashCustodianRole;
    }
    return 'ACCOUNTANT';
  }

  /**
   * Returns the currently-assigned custodian for the given CompanyInfo
   * (or FINANCE by default). Used by both the Settings UI render + future
   * petty-cash voucher footer signing.
   */
  async getPettyCashCustodian(
    companyId?: string,
  ): Promise<{
    companyId: string;
    companyCode: string | null;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  } | null> {
    const company = companyId
      ? await this.prisma.companyInfo.findFirst({
          where: { id: companyId, deletedAt: null },
          include: {
            pettyCashCustodian: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        })
      : await this.prisma.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          include: {
            pettyCashCustodian: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        });
    if (!company) return null;
    const custodianRole = await this.getPettyCashCustodianRole();
    return {
      companyId: company.id,
      companyCode: company.companyCode,
      custodianRole,
      custodian: company.pettyCashCustodian
        ? {
            id: company.pettyCashCustodian.id,
            name: company.pettyCashCustodian.name,
            email: company.pettyCashCustodian.email,
            role: company.pettyCashCustodian.role,
          }
        : null,
    };
  }

  /**
   * Assigns (or clears) the Petty Cash custodian on a CompanyInfo. Validates
   * target user's role against the configured whitelist when assigning;
   * `userId=null` clears the seat (always allowed).
   *
   * Audit `PETTY_CASH_CUSTODIAN_ASSIGNED` action — captures both old + new
   * userIds so reviewers can trace handoffs.
   */
  async assignPettyCashCustodian(
    actorUserId: string,
    opts: { companyId?: string; userId: string | null | undefined },
  ): Promise<{
    companyId: string;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  }> {
    // Default to FINANCE (single petty-cash drawer for now; SHOP support
    // when SHOP-side accounting lands in Phase A.5).
    const targetCompany = opts.companyId
      ? await this.prisma.companyInfo.findFirst({
          where: { id: opts.companyId, deletedAt: null },
          select: { id: true, companyCode: true, pettyCashCustodianId: true },
        })
      : await this.prisma.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true, companyCode: true, pettyCashCustodianId: true },
        });
    if (!targetCompany) {
      throw new NotFoundException('ไม่พบข้อมูลบริษัทสำหรับกำหนดผู้ดูแลเงินสดย่อย');
    }

    const newUserId = opts.userId ?? null;
    const role = await this.getPettyCashCustodianRole();

    // Validate the proposed user when assigning (null clears — always OK).
    if (newUserId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: newUserId, isActive: true, deletedAt: null },
        select: { id: true, role: true, name: true, email: true },
      });
      if (!user) {
        throw new NotFoundException('ไม่พบผู้ใช้งานที่จะกำหนดเป็นผู้ดูแลเงินสดย่อย');
      }
      if (user.role !== role) {
        throw new BadRequestException(
          `ผู้ใช้งานต้องมีบทบาท ${role} (พบ ${user.role}) — สามารถเปลี่ยนบทบาทที่อนุญาตได้ที่ SystemConfig.petty_cash_custodian_role`,
        );
      }
    }

    const oldUserId = targetCompany.pettyCashCustodianId;

    await this.prisma.companyInfo.update({
      where: { id: targetCompany.id },
      data: { pettyCashCustodianId: newUserId },
    });

    // Audit log — fire-and-forget per the existing pattern.
    await this.audit.log({
      userId: actorUserId,
      action: 'PETTY_CASH_CUSTODIAN_ASSIGNED',
      entity: 'CompanyInfo',
      entityId: targetCompany.id,
      oldValue: { pettyCashCustodianId: oldUserId },
      newValue: { pettyCashCustodianId: newUserId },
    });

    // Reload the fresh assignment for the response payload.
    const fresh = await this.getPettyCashCustodian(targetCompany.id);
    // getPettyCashCustodian returns null only when the company was deleted
    // mid-transaction (impossible here since we just updated it).
    if (!fresh) {
      throw new NotFoundException('โหลดข้อมูลผู้ดูแลเงินสดย่อยไม่สำเร็จ');
    }
    return {
      companyId: fresh.companyId,
      custodianRole: fresh.custodianRole,
      custodian: fresh.custodian,
    };
  }

  /**
   * Returns the eligible-user pool for the Petty Cash custodian picker.
   * Filtered to active, non-deleted users whose role matches the configured
   * whitelist value. Sorted by name for stable rendering.
   */
  async getEligibleCustodians(): Promise<
    { id: string; name: string; email: string; role: string }[]
  > {
    const role = await this.getPettyCashCustodianRole();
    return this.prisma.user.findMany({
      where: { role, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
