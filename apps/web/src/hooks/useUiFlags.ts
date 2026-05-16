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
  return data ?? DEFAULT_UI_FLAGS;
}
