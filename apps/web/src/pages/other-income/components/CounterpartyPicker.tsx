import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search } from 'lucide-react';

interface Counterparty {
  customerId: string | null;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface Props {
  value: Counterparty;
  onChange: (cp: Counterparty) => void;
}

interface CustomerLite {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
}

/**
 * Dual-mode picker:
 * - Type a name → either pick from customer dropdown OR keep as free-text counterparty.
 * - Useful for ดอกเบี้ยฝาก (counterparty='KBank' free-text) and corporate buyer (Customer FK).
 */
export function CounterpartyPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState(value.name ?? '');
  const [open, setOpen] = useState(false);

  const { data: customers } = useQuery<CustomerLite[]>({
    queryKey: ['customers', 'search', search],
    queryFn: async () => {
      if (search.trim().length < 2) return [];
      const res = await api.get('/customers', { params: { q: search, limit: 10 } });
      return (res.data?.data ?? []) as CustomerLite[];
    },
    enabled: search.trim().length >= 2,
  });

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            // Update free-text mode immediately
            onChange({
              customerId: null,
              name: e.target.value,
              taxId: value.taxId,
              address: value.address,
              phone: value.phone,
            });
          }}
          onFocus={() => setOpen(true)}
          placeholder="พิมพ์ชื่อลูกค้า/คู่ค้า (ถ้าไม่มี → ใช้เป็นข้อความ)"
          className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
        />
      </div>
      {open && customers && customers.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({
                  customerId: c.id,
                  name: c.name,
                  taxId: c.taxId,
                  address: c.address,
                  phone: c.phone,
                });
                setSearch(c.name);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-accent border-b text-sm"
            >
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {c.taxId ?? '—'} · {c.phone ?? '—'}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange({ customerId: null, name: search });
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 hover:bg-accent text-xs italic text-muted-foreground"
          >
            ใช้ &quot;{search}&quot; เป็นข้อความ (ไม่มีในระบบลูกค้า)
          </button>
        </div>
      )}
    </div>
  );
}
