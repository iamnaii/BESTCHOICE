import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { toast } from 'sonner';
import { useClaimPool, usePool } from '../hooks/usePool';

interface PoolItem {
  id: string;
  escalationFlag: boolean;
  contract: {
    contractNumber: string;
    daysOverdue?: number;
    outstanding?: number | null;
    customer: { name: string };
  };
}

export default function PoolBrowser({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = usePool();
  const claim = useClaimPool();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items: PoolItem[] = (data as PoolItem[] | undefined) ?? [];

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm max-w-3xl mx-auto">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold leading-snug">Pool กลาง</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {items.length} รายการ — หยิบเพิ่มได้
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ปิด
        </Button>
      </div>
      <div className="divide-y divide-border/40">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground leading-snug">
            ไม่มีงานใน pool ตอนนี้
          </div>
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-primary leading-snug">
                  {a.contract.contractNumber}
                </div>
                <div className="text-sm font-semibold truncate leading-snug">
                  {a.contract.customer.name}
                </div>
                <div className="text-2xs text-muted-foreground leading-snug">
                  ค้าง {a.contract.daysOverdue ?? 0} วัน ·{' '}
                  {a.contract.outstanding != null
                    ? `${formatNumber(a.contract.outstanding)} ฿`
                    : '—'}
                  {a.escalationFlag && (
                    <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="size-3" /> Escalation
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  claim.mutate(a.id, {
                    onSuccess: () => toast.success('หยิบงานเข้า session แล้ว'),
                    onError: () =>
                      toast.error('ไม่สามารถหยิบได้ — อาจมีคนอื่นหยิบไปก่อน'),
                  });
                }}
                disabled={claim.isPending}
              >
                หยิบ
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
