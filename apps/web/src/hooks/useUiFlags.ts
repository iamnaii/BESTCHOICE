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
  /**
   * D1.2.1.1 — opt-in Approval Workflow. When `false` (default), expense docs
   * follow the legacy DRAFT → POSTED lifecycle. When `true`, the lifecycle
   * becomes DRAFT → PENDING_APPROVAL → APPROVED → POSTED. The web UI uses
   * this flag to gate the "ส่งขออนุมัติ" button (instead of "Post") on DRAFT
   * docs.
   *
   * Backend gate lives on `/expense-documents/:id/submit-for-approval` (D1.2.1.1)
   * and `/expense-documents/:id/approve` (D1.2.1.6). Frontend value defaults
   * to false until backend PR #923 merges.
   */
  approvalEnabled: boolean;
  /**
   * D1.2.1.2 — threshold (THB) above which docs require approval. The UI uses
   * this only to surface a helper text explaining why the doc was routed to
   * approval. Backend remains the source of truth for the gating decision.
   * Defaults to 0 (= every doc needs approval when approvalEnabled is true).
   */
  approvalThreshold: number;
  /**
   * D1.2.1.3 — list of user IDs that may approve PENDING_APPROVAL docs (in
   * addition to OWNER). OWNER can always approve regardless of this list.
   * Defaults to empty array. Backend re-validates membership before approve()
   * — frontend uses this to conditionally render the "อนุมัติเอกสาร" button
   * for the current user.
   */
  approversList: string[];
  /**
   * D1.2.1.4 — document types that ALWAYS require approval (independent of
   * threshold). OR-composed with approvalThreshold. Default `['PAYROLL']`
   * per spec — payroll always needs HR/Finance sign-off.
   */
  approvalRequiredDocTypes: string[];
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
  approvalEnabled: false,
  approvalThreshold: 0,
  approversList: [],
  approvalRequiredDocTypes: ['PAYROLL'],
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
  return flags;
}
