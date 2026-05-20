import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, Wrench, Repeat } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import QueryBoundary from '@/components/QueryBoundary';
import { WarrantyWindowCard } from './components/WarrantyWindowCard';
import { useAuth } from '@/contexts/AuthContext';

type SearchMode = 'customer' | 'imei' | 'contract';

interface DeviceResult {
  product: { id: string; brand: string; model: string; imeiSerial: string | null };
  contract: { id: string; contractNumber: string; status: string } | null;
  warrantyWindows: { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null };
  eligibility: { forExchange: boolean; forRepair: boolean };
}

interface LookupResponse {
  customer: { id: string; name: string; phone: string | null } | null;
  devices: DeviceResult[];
}

export default function WarrantyCheckPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateTicket = !!user && ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user.role);

  const [mode, setMode] = useState<SearchMode>('imei');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const queryParam = (() => {
    if (mode === 'customer') return 'customerId';
    if (mode === 'imei') return 'imei';
    return 'contractNumber';
  })();

  const { data, isLoading, isError, error, refetch } = useQuery<LookupResponse>({
    queryKey: ['warranty-lookup', mode, submitted],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set(queryParam, submitted);
      const { data: responseData } = await api.get(`/repair-tickets/warranty-lookup?${params}`);
      return responseData;
    },
    enabled: !!submitted,
    retry: false,
  });

  const startTicket = (device: DeviceResult, intent: 'repair' | 'exchange') => {
    const params = new URLSearchParams();
    if (data?.customer) params.set('customerId', data.customer.id);
    params.set('productId', device.product.id);
    if (device.contract) params.set('contractId', device.contract.id);
    params.set('intent', intent);
    navigate(`/insurance/new?${params.toString()}`);
  };

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-4xl">
      <PageHeader
        title="เช็คประกัน"
        subtitle="ตรวจสถานะประกันเครื่องของลูกค้า — ไม่ต้องสร้าง ticket"
      />

      <Card className="p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          {(['customer', 'imei', 'contract'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setMode(m);
                setSubmitted('');
                setQuery('');
              }}
            >
              {m === 'customer' ? 'ลูกค้า' : m === 'imei' ? 'IMEI/Serial' : 'เลขสัญญา'}
            </Button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
          className="flex gap-2"
        >
          <Input
            placeholder={
              mode === 'customer'
                ? 'Customer UUID (จาก /customers — รอ integrate autocomplete)'
                : mode === 'imei'
                  ? 'IMEI หรือ Serial Number'
                  : 'เลขที่สัญญา เช่น CN-2026-0001'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!query || query.length < 3}>
            <Search className="mr-2 h-4 w-4" /> ค้นหา
          </Button>
        </form>
      </Card>

      {submitted && (
        <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {!data?.devices.length ? (
            <Card className="p-12 text-center text-muted-foreground">ไม่พบเครื่องในระบบ</Card>
          ) : (
            <div className="space-y-3">
              {data?.customer && (
                <Card className="p-3 bg-muted/30">
                  <p className="text-sm">
                    <span className="font-medium">{data.customer.name}</span>
                    {data.customer.phone && (
                      <span className="text-muted-foreground"> · {data.customer.phone}</span>
                    )}
                  </p>
                </Card>
              )}

              {data.devices.map((d, i) => (
                <Card key={d.product.id ?? i} className="p-4 space-y-3">
                  <div>
                    <p className="font-medium">
                      {d.product.brand} {d.product.model}
                    </p>
                    {d.product.imeiSerial && (
                      <p className="text-xs text-muted-foreground">IMEI: {d.product.imeiSerial}</p>
                    )}
                    {d.contract && (
                      <p className="text-xs text-muted-foreground">
                        สัญญา: {d.contract.contractNumber}
                      </p>
                    )}
                  </div>

                  <WarrantyWindowCard windows={d.warrantyWindows} />

                  {canCreateTicket && (
                    <div className="flex gap-2 pt-2 border-t">
                      <Button size="sm" onClick={() => startTicket(d, 'repair')}>
                        <Wrench className="mr-2 h-4 w-4" /> ส่งซ่อม
                      </Button>
                      {d.eligibility.forExchange && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startTicket(d, 'exchange')}
                        >
                          <Repeat className="mr-2 h-4 w-4" /> เปลี่ยนเครื่อง
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}
