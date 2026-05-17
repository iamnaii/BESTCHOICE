import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import api from '@/lib/api';
import { setThousandsSeparator } from '@/utils/formatters';
import { setDefaultDecimalPlaces } from '@/utils/formatters';
import { setDateFormatPreference } from '@/utils/formatters';

/**
 * D1.* — UI feature flags fetched from /settings/ui-flags.
 *
 * Backed by SystemConfig rows that OWNER edits via Settings page (existing
 * PATCH /settings flow). Endpoint is authenticated but NOT @Roles-gated to
 * OWNER, so any role can read the flags they need to render their UI.
 *
 * Defaults match the spec-defined "on" behavior — first-render before fetch
 * resolves uses the defaults so the warning UI never silently flickers off.
 */
export interface UiFlags {
  /** D1.2.8.2 — show ม.42 tax-exempt warning when payroll line marked non-taxable. */
  taxExemptWarningEnabled: boolean;
  /** D1.2.7.1 — require reason on void/reverse dialog. */
  reverseReasonRequired: boolean;
  /** D1.2.7.2 — configurable reverse-reason dropdown. */
  reverseReasons: { code: string; label: string }[];
  /** D1.2.7.3 — soft warning threshold (days) when reverse backdate exceeds this; UI-only. */
  reverseManagerApprovalDays: number;
  /** D1.2.6.3 — broader backdate warning threshold (days). Default 30. */
  paymentDateWarningBackdate: number;
  /** D1.2.6.4 — allow forward-dated transactions. Default true. */
  paymentDateAllowFuture: boolean;
  /** D1.2.6.1 — day-of-month when periods close. Default 31. Informational. */
  periodCloseDay: number;
  /** D1.2.2.7 — render verification QR on voucher footers. Default true. */
  voucherShowQrCode: boolean;
  /** D1.2.2.5 — primary theme color hex. Default emerald. Informational. */
  themeColor: string;
  /** D1.2.2.6 — UI language. Applied to `document.lang`; i18n framework deferred. */
  language: 'th' | 'en';
  /** D1.1.5.4 — Petty Cash replenish alert threshold (THB). Default 5000, 0 disables. */
  pettyCashReplenishThreshold: number;
  /** D1.1.5.1 — Petty Cash feature flag. Default true. Hides DocTypePicker card + form section when false. */
  pettyCashEnabled: boolean;
  /**
   * D1.2.5.3 — render the 3-column partial-payment breakdown (ยอดเดิม /
   * ยอดที่ชำระ / ยอดคงเหลือ) on the voucher. Default true. When false the
   * voucher shows only a single "ยอดที่ชำระ" column.
   */
  voucherShowPartialColumns: boolean;
  /**
   * D1.2.5.2 — include the adjustment rows (52-1104 rounding, 53-1503 overpay)
   * in the printable voucher layout. Default true. When false the rows stay
   * on screen (JE preview) but are hidden by the print stylesheet.
   */
  voucherIncludeAdjustment: boolean;
  /**
   * D1.2.5.1 — voucher print mode. 'multi' (default) emits both ต้นฉบับ and
   * สำเนา on separate A4 pages; 'single' emits only ต้นฉบับ.
   */
  voucherPrintMode: 'single' | 'multi';
  /**
   * D1.2.4.1 — Expense Templates feature flag. Default true. When false,
   * the API rejects all template writes (create/update/delete/instantiate)
   * with 403, and the UI hides "บันทึกเป็นรายการโปรด" affordances + the
   * favorites list. Read endpoints still resolve so legacy data stays
   * accessible to auditors.
   */
  templatesEnabled: boolean;
  /**
   * D1.2.4.2 — per-user quota of saved Expense Templates. Default 20.
   * Clamped to 1–1000 server-side. UI surfaces as "X/N" badge on the
   * favorites picker so users see how close they are to the cap. Server
   * enforces the cap atomically (see ExpenseTemplatesService.create).
   */
  maxTemplatesPerUser: number;
  /**
   * D1.2.4.4 — gates the `{{variable}}` interpolation surface on Expense
   * Templates (the "ใส่ตัวแปร" affordance). The pure util in
   * apps/api/src/utils/template-interpolation.util.ts is always
   * available; this flag controls whether the UI exposes it.
   */
  templateVariablesEnabled: boolean;
  /**
   * D1.2.4.3 — default visibility selection on the "บันทึกเป็นรายการโปรด"
   * dialog. PRIVATE = creator-only (default), TEAM = creator + explicit
   * grants, PUBLIC = visible to all authenticated users.
   */
  templateSharingDefault: 'PRIVATE' | 'TEAM' | 'PUBLIC';
  /** D1.2.3.5 — thousands separator style for the generic number formatter. */
  thousandsSeparator: 'comma' | 'space' | 'none';
  /** D1.2.3.4 — default decimal places (0-4) for the generic number formatter. */
  decimalPlaces: number;
  /** D1.2.3.3 — date display preference: BE (พ.ศ., +543) default or CE (ค.ศ.). */
  dateFormat: 'BE' | 'CE';
  /** D1.2.3.2 — default pagination size (list pages). Integer 10-200; default 50. */
  paginationSize: number;
  /** D1.2.3.1 — default time-range preset for list pages. Default 'this_month'. */
  defaultTimeRange: 'all' | 'this_month' | 'last_month';
  /** D1.3.1.2 — AP-due alerts cron toggle. Default false (off). */
  apDueAlertsEnabled: boolean;
  /** D1.3.1.2 — days since documentDate before AP-due alert fires. Default 3. */
  apDueDaysBefore: number;
  /** D1.3.1.1 — opt-in DRAFT alerts cron. Default false (off). */
  draftAlertsEnabled: boolean;
  /** D1.3.1.1 — days a doc must stay DRAFT before alert fires. Default 7. */
  draftAlertThresholdDays: number;
  /**
   * D1.2.1.1 — Approval Workflow opt-in. When true, expense docs follow
   * DRAFT → PENDING_APPROVAL → APPROVED → POSTED. UI uses this flag to
   * conditionally render the "ส่งขออนุมัติ" button instead of "Post".
   * Default false (legacy DRAFT → POSTED lifecycle).
   */
  approvalEnabled: boolean;
  /**
   * D1.1.6 — adjustment account codes for the V4 multi-line Adjustment row.
   * Frontend was hardcoding '52-1104' / '53-1503'; now reads from this flag
   * so OWNER can rebind the codes without a frontend deploy.
   */
  adjustmentCodes: { underpay: string; overpay: string };
  /**
   * D1.4.1.1 — BOOTSTRAP default for sidebar collapse on a new device
   * (no `sidebar_collapse` key in localStorage). Per-user preference takes
   * over the moment the user toggles the sidebar. Default false (= expanded).
   */
  sidebarCollapsedDefault: boolean;
  /**
   * D1.4.1.2 — when false, hide keyboard-shortcut UI affordances:
   * the global Shift+? help-dialog binding is disabled and per-item kbd
   * hints are suppressed. Default true preserves existing UX.
   */
  showKeyboardShortcuts: boolean;
  /**
   * D1.4.1.3 — global animations + transitions toggle. When false, the
   * hook sets `data-animations-disabled="true"` on `<html>` and a CSS rule
   * strips `transition` / `animation` from every element. Default true.
   */
  animationEnabled: boolean;
  /** D1.3.1.4 — IN_APP channel master toggle. Default true. */
  inAppNotificationsEnabled: boolean;
  /**
   * D1.4.1.4 — BOOTSTRAP default theme for first-time devices (no `theme`
   * key in localStorage). 'system' = respect OS prefers-color-scheme.
   */
  darkModeDefault: 'light' | 'dark' | 'system';
  /**
   * D1.4.2.1 — long-running query timeout (seconds). Default 30; valid 5–300.
   * INFORMATIONAL today — axios client uses a fixed 15s timeout and Postgres
   * `statement_timeout` is a DB-level setting. Exposed so OWNER can advertise
   * the intended cutoff; a future PR can wire it.
   */
  queryTimeoutSeconds: number;
  /** D1.3.1.3 — active email provider. Sendgrid requires API-key wiring before use. */
  emailProvider: 'smtp' | 'sendgrid';
  /**
   * D1.4.2.2 — react-query `staleTime` (seconds) for dashboard queries.
   * Default 60, valid 10–3600. Wired into `DashboardPage`'s
   * `dashboardStaleTime`.
   */
  cacheTtlDashboard: number;
  /**
   * D1.4.2.3 — react-query `staleTime` (seconds) for aggregated report
   * queries (P&L, trial balance, monthly P&L, etc.). Default 300s, valid
   * 30–7200. Wired into `ProfitLossPage`.
   */
  cacheTtlReports: number;
}

const DEFAULT_UI_FLAGS: UiFlags = {
  taxExemptWarningEnabled: true,
  reverseReasonRequired: true,
  reverseReasons: [
    { code: 'data_entry_error', label: 'ป้อนข้อมูลผิด' },
    { code: 'wrong_vendor', label: 'ผู้ขายผิด' },
    { code: 'wrong_amount', label: 'จำนวนเงินผิด' },
    { code: 'duplicate_entry', label: 'ข้อมูลซ้ำ' },
    { code: 'cancel_transaction', label: 'ยกเลิกรายการ' },
    { code: 'other', label: 'อื่นๆ (ระบุรายละเอียด)' },
  ],
  reverseManagerApprovalDays: 7,
  paymentDateWarningBackdate: 30,
  paymentDateAllowFuture: true,
  periodCloseDay: 31,
  voucherShowQrCode: true,
  themeColor: '#10b981',
  language: 'th',
  pettyCashReplenishThreshold: 5000,
  pettyCashEnabled: true,
  voucherShowPartialColumns: true,
  voucherIncludeAdjustment: true,
  voucherPrintMode: 'multi',
  templatesEnabled: true,
  maxTemplatesPerUser: 20,
  templateVariablesEnabled: true,
  templateSharingDefault: 'PRIVATE',
  thousandsSeparator: 'comma',
  decimalPlaces: 2,
  dateFormat: 'BE',
  approvalEnabled: false,
  paginationSize: 50,
  defaultTimeRange: 'this_month',
  apDueAlertsEnabled: false,
  apDueDaysBefore: 3,
  draftAlertsEnabled: false,
  draftAlertThresholdDays: 7,
  adjustmentCodes: { underpay: '52-1104', overpay: '53-1503' },
  sidebarCollapsedDefault: false,
  showKeyboardShortcuts: true,
  animationEnabled: true,
  inAppNotificationsEnabled: true,
  darkModeDefault: 'system',
  queryTimeoutSeconds: 30,
  emailProvider: 'smtp',
  cacheTtlDashboard: 60,
  cacheTtlReports: 300,
};

export function useUiFlags(): UiFlags {
  const { data } = useQuery<UiFlags>({
    queryKey: ['settings-ui-flags'],
    queryFn: async () => {
      const { data } = await api.get<UiFlags>('/settings/ui-flags');
      return data;
    },
    staleTime: 5 * 60_000, // 5 min — flags rarely change mid-session
  });
  const flags = data ?? DEFAULT_UI_FLAGS;
  const { setTheme } = useTheme();
  // D1.2.2.6 — sync the document `lang` attribute so accessibility readers
  // and `<input>` locale heuristics respect the OWNER-configured language
  // even before a full i18n framework is in place.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = flags.language;
    }
  }, [flags.language]);
  // D1.2.3.5 — sync the module-level thousands-separator pref so pure
  // formatNumber / formatNumberDecimal calls respect the OWNER pref.
  useEffect(() => {
    setThousandsSeparator(flags.thousandsSeparator);
  }, [flags.thousandsSeparator]);
  // D1.2.3.4 — sync the module-level default decimal-places preference so
  // pure `formatNumberDecimal()` calls (in exports, badges, etc.) respect
  // the OWNER pref. Call sites that pass an explicit digit count are
  // unaffected — the pref is the *default only*.
  useEffect(() => {
    setDefaultDecimalPlaces(flags.decimalPlaces);
  }, [flags.decimalPlaces]);
  // D1.2.3.3 — sync the module-level date format preference so pure
  // `formatDateShort` / `formatDateMedium` / `formatDateTime` calls inside
  // non-React code (excel exports, status badges) respect the OWNER pref.
  useEffect(() => {
    setDateFormatPreference(flags.dateFormat);
  }, [flags.dateFormat]);
  // D1.4.1.1 — first-time-device seed for sidebar collapse. Only writes when
  // localStorage has NO `sidebar_collapse` key yet, so we never clobber an
  // existing per-user preference. Runs once after the flags resolve.
  useEffect(() => {
    if (!data) return; // wait for server flags before deciding
    try {
      if (typeof window === 'undefined') return;
      if (localStorage.getItem('sidebar_collapse') !== null) return;
      localStorage.setItem('sidebar_collapse', String(flags.sidebarCollapsedDefault));
    } catch {
      /* ignore quota / disabled-storage */
    }
  }, [data, flags.sidebarCollapsedDefault]);
  // D1.4.1.3 — toggle global animations. CSS rule in `index.css` matches
  // `[data-animations-disabled="true"]` and strips transitions + animations.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (flags.animationEnabled) {
      document.documentElement.removeAttribute('data-animations-disabled');
    } else {
      document.documentElement.setAttribute('data-animations-disabled', 'true');
    }
  }, [flags.animationEnabled]);
  // D1.4.1.4 — first-time-device seed for theme. next-themes stores the
  // user preference in `localStorage.theme`. When that key is absent AND
  // the flags have loaded, seed it from `flags.darkModeDefault`. After
  // the first toggle by the user, this no-ops (key present → bail).
  useEffect(() => {
    if (!data) return; // wait for server flags
    try {
      if (typeof window === 'undefined') return;
      if (localStorage.getItem('theme') !== null) return; // user preference wins
      setTheme(flags.darkModeDefault);
    } catch {
      /* ignore storage errors */
    }
  }, [data, flags.darkModeDefault, setTheme]);
  return flags;
}

/**
 * D1.2.3.3 — Convenience hook for components that only need the date format
 * preference (avoids subscribing to the whole flag object).
 */
export function useDateFormat(): 'BE' | 'CE' {
  return useUiFlags().dateFormat;
}
