import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { Banknote, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accountDisplayName } from '@/utils/accountName';

interface CoaRow { code: string; name: string }

interface Props {
  value?: string;
  onChange: (code: string) => void;
  /** Account codes to offer. Default = FINANCE cash set; payroll SHOP scope
   *  passes SHOP_CASH_ACCOUNT_CODES (S11-XXXX). */
  codes?: readonly string[];
}

/** Visual cash account selector — replaces the dropdown. Layout: cash codes (XX-11xx) + bank codes (XX-12xx) in rows of 3. */
export function CashAccountVisualPicker({ value, onChange, codes = CASH_ACCOUNT_CODES }: Props) {
  const { data } = useQuery<CoaRow[]>({
    queryKey: ['chart-of-accounts', 'cash-codes', codes.join(',')],
    queryFn: async () => (await api.get(`/chart-of-accounts/by-codes?codes=${codes.join(',')}`)).data,
    staleTime: Infinity,
  });
  const nameMap = new Map<string, string>(data?.map((r) => [r.code, r.name]) ?? []);

  return (
    <div className="grid grid-cols-3 gap-3">
      {codes.map((code) => {
        const isBank = code.includes('-12');
        const Icon = isBank ? Landmark : Banknote;
        const selected = value === code;
        return (
          <button
            type="button"
            key={code}
            onClick={() => onChange(code)}
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
              selected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border bg-card hover:bg-accent',
            )}
            aria-pressed={selected}
          >
            <Icon className={cn('size-4 mt-0.5', selected ? 'text-primary' : 'text-muted-foreground')} />
            <div className="flex-1 min-w-0">
              <div className="text-sm leading-snug truncate">{accountDisplayName(nameMap.get(code) ?? '—')}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
