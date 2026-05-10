import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { Banknote, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CoaRow { code: string; name: string }

interface Props {
  value?: string;
  onChange: (code: string) => void;
}

/** Visual 6-card cash account selector — replaces the dropdown. Layout: 3 cash codes (11-11xx) + 3 bank codes (11-12xx) in 2 rows. */
export function CashAccountVisualPicker({ value, onChange }: Props) {
  const { data } = useQuery<CoaRow[]>({
    queryKey: ['chart-of-accounts', 'cash-codes'],
    queryFn: async () => (await api.get(`/chart-of-accounts/by-codes?codes=${CASH_ACCOUNT_CODES.join(',')}`)).data,
    staleTime: Infinity,
  });
  const nameMap = new Map<string, string>(data?.map((r) => [r.code, r.name]) ?? []);

  return (
    <div className="grid grid-cols-3 gap-3">
      {CASH_ACCOUNT_CODES.map((code) => {
        const isBank = code.startsWith('11-12');
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
              <div className="font-mono text-xs text-muted-foreground">{code}</div>
              <div className="text-sm leading-snug truncate">{nameMap.get(code) ?? '—'}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
