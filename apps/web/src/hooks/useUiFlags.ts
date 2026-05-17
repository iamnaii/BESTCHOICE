import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

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
  /** D1.2.3.2 — default pagination size (list pages). Integer 10-200; default 50. */
  paginationSize: number;
  /** D1.2.3.1 — default time-range preset for list pages. Default 'this_month'. */
  defaultTimeRange: 'all' | 'this_month' | 'last_month';
  /** D1.3.1.1 — opt-in DRAFT alerts cron. Default false (off). */
  draftAlertsEnabled: boolean;
  /** D1.3.1.1 — days a doc must stay DRAFT before alert fires. Default 7. */
  draftAlertThresholdDays: number;
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
  paginationSize: 50,
  defaultTimeRange: 'this_month',
  draftAlertsEnabled: false,
  draftAlertThresholdDays: 7,
  adjustmentCodes: { underpay: '52-1104', overpay: '53-1503' },
  sidebarCollapsedDefault: false,
  showKeyboardShortcuts: true,
  animationEnabled: true,
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
  // D1.2.2.6 — sync the document `lang` attribute so accessibility readers
  // and `<input>` locale heuristics respect the OWNER-configured language
  // even before a full i18n framework is in place.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = flags.language;
    }
  }, [flags.language]);
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
  return flags;
}
