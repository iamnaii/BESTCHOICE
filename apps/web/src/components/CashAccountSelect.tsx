import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { accountDisplayName } from '@/utils/accountName';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Cash and bank account codes supported for payment deposit dimension (T15). */
export const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

/**
 * ธนาคารกสิกร (KBank) only — for flows where money must arrive at FINANCE's
 * KBank account directly (early payoff JP4 + repossession JP5, owner rule
 * 2026-07-08). Cash collected at a branch uses the shop-collect toggle
 * (Dr 11-2107) instead of a cash account.
 */
export const KBANK_ONLY_CODES = ['11-1201'] as const;

interface CoaRow {
  code: string;
  name: string;
}

export interface CashAccountSelectProps {
  value?: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Restrict the selectable codes — default: all 6 cash/bank codes. */
  codes?: readonly string[];
}

/**
 * T15 — dropdown to select a cash/bank account code from the 6 valid codes
 * (or a caller-restricted subset via `codes`, e.g. KBANK_ONLY_CODES).
 * Fetches human-readable names from GET /chart-of-accounts/by-codes.
 * Falls back to showing the code alone if the endpoint returns no name.
 */
export function CashAccountSelect({
  value,
  onChange,
  disabled,
  placeholder = 'เลือกบัญชีรับเงิน',
  codes = CASH_ACCOUNT_CODES,
}: CashAccountSelectProps) {
  const { data, isLoading } = useQuery<CoaRow[]>({
    queryKey: ['chart-of-accounts', 'cash-codes', codes.join(',')],
    queryFn: async () => {
      const res = await api.get<CoaRow[]>(`/chart-of-accounts/by-codes?codes=${codes.join(',')}`);
      return res.data;
    },
    staleTime: Infinity, // CoA names rarely change — no need to refetch
  });

  // Build a name lookup; fall back to empty string so we always show code
  const nameMap = new Map<string, string>(data?.map((a) => [a.code, a.name]) ?? []);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            {accountDisplayName(nameMap.get(code) ?? '')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
