import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import type { Customer } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface CustomerSearchProps {
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  onClearCustomer: () => void;
}

export default function CustomerSearch({
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  onSelectCustomer,
  onClearCustomer,
}: CustomerSearchProps) {
  const debouncedCustomerSearch = useDebounce(customerSearch);

  const {
    data: customers,
    isFetching: customersFetching,
    isError: customersError,
  } = useQuery<Customer[]>({
    queryKey: ['pos-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const { data } = await api.get('/customers/search', {
        params: { q: debouncedCustomerSearch },
      });
      return data;
    },
    enabled: !!debouncedCustomerSearch && debouncedCustomerSearch.length >= 2,
  });

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="text-sm font-semibold text-foreground">เลือกลูกค้า</div>
      </CardHeader>
      <CardContent>
        {selectedCustomer ? (
          <div className="flex items-center justify-between bg-muted rounded-lg p-3">
            <div>
              <div className="text-sm font-medium">{selectedCustomer.name}</div>
              <div className="text-xs text-muted-foreground">
                {selectedCustomer.phone} | สัญญา {selectedCustomer._count.contracts} รายการ
              </div>
            </div>
            <button onClick={onClearCustomer} className="text-xs text-red-500 hover:underline">
              เปลี่ยน
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร..."
              className={inputClass}
            />
            {customerSearch.length >= 2 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                {customersError ? (
                  <div className="px-3 py-4 text-center text-sm text-destructive">
                    ค้นหาลูกค้าไม่สำเร็จ กรุณาลองใหม่
                  </div>
                ) : customersFetching ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2" />
                    กำลังค้นหา...
                  </div>
                ) : customers && customers.length > 0 ? (
                  customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        onSelectCustomer(c);
                        setCustomerSearch('');
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                    >
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.phone}</div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    ไม่พบลูกค้าที่ตรงกับ &quot;{customerSearch}&quot;
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
