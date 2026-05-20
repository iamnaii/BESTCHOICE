import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Repeat, Wrench } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { WarrantyWindowCard, WarrantyWindows } from '../components/WarrantyWindowCard';
import { WarrantyBadge, WarrantyStatus } from '../components/WarrantyBadge';

export type WizardFlow = 'repair' | 'exchange';

interface PreviewResponse {
  warrantyStatus: WarrantyStatus;
  defaultFlow: WizardFlow;
  alternativeFlow: WizardFlow | null;
  defaultPayer: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
  daysRemaining: WarrantyWindows;
  eligibility: { forExchange: boolean; forRepair: boolean };
  blockingReasons?: string[];
}

export function WarrantyPreviewStep({
  customerId,
  contractId,
  productId,
  chosenFlow,
  onChoose,
  onNext,
  onBack,
}: {
  customerId?: string;
  contractId?: string;
  productId?: string;
  chosenFlow: WizardFlow | null;
  onChoose: (flow: WizardFlow) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data, isLoading, isError } = useQuery<PreviewResponse>({
    queryKey: ['warranty-preview', customerId, contractId, productId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerId) params.set('customerId', customerId);
      if (contractId) params.set('contractId', contractId);
      if (productId) params.set('productId', productId);
      const { data } = await api.get(`/repair-tickets/warranty-preview?${params}`);
      return data as PreviewResponse;
    },
  });

  // Auto-select defaultFlow on first load (smart default B3)
  useEffect(() => {
    if (data && !chosenFlow) {
      onChoose(data.defaultFlow);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">กำลังตรวจสอบประกัน...</p>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="p-6 space-y-3">
        <p className="text-destructive text-sm">เกิดข้อผิดพลาดในการตรวจสอบประกัน</p>
        <Button variant="outline" onClick={onBack}>
          ← ย้อน
        </Button>
      </Card>
    );
  }

  if (!data.eligibility.forRepair && !data.eligibility.forExchange) {
    return (
      <Card className="p-6 space-y-3">
        <h3 className="font-medium text-destructive">ไม่สามารถดำเนินการได้</h3>
        <ul className="list-disc pl-5 text-sm">
          {(data.blockingReasons ?? ['ไม่ทราบสาเหตุ']).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <Button variant="outline" onClick={onBack}>
          ← ย้อน
        </Button>
      </Card>
    );
  }

  const effectiveFlow = chosenFlow ?? data.defaultFlow;

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">3. ตรวจสอบประกัน</h3>

      <WarrantyBadge status={data.warrantyStatus} />
      <WarrantyWindowCard windows={data.daysRemaining} />

      <div className="space-y-2 pt-2">
        <p className="text-sm text-muted-foreground">วิธีการแก้ปัญหา</p>

        {data.eligibility.forExchange && (
          <button
            type="button"
            onClick={() => onChoose('exchange')}
            className={cn(
              'w-full p-4 rounded-lg border-2 text-left transition-colors',
              effectiveFlow === 'exchange'
                ? 'border-primary bg-primary/5'
                : 'border-muted hover:bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              <Repeat className="h-5 w-5" /> เปลี่ยนเครื่องใหม่
              <span className="text-xs text-muted-foreground font-normal">(ภายใน 7 วัน)</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              ออกเครื่องใหม่ทดแทน + โอน credit จากสัญญาเดิม
            </p>
          </button>
        )}

        <button
          type="button"
          onClick={() => onChoose('repair')}
          className={cn(
            'w-full p-4 rounded-lg border-2 text-left transition-colors',
            effectiveFlow === 'repair'
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:bg-muted/30',
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            <Wrench className="h-5 w-5" /> ส่งซ่อม
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            ส่งเครื่องเดิมไปซ่อม
            {data.defaultPayer === 'CUSTOMER' && ' · ค่าซ่อมลูกค้าจ่าย'}
            {data.defaultPayer === 'SHOP' && ' · ร้านจ่าย (ในประกัน)'}
          </p>
        </button>

        {data.defaultFlow === 'exchange' &&
          data.alternativeFlow === 'repair' &&
          effectiveFlow === 'exchange' && (
            <button
              type="button"
              onClick={() => onChoose('repair')}
              className="text-xs text-primary underline pt-1"
            >
              ขอส่งซ่อมแทน (ลูกค้าอยากเก็บ IMEI เดิม)
            </button>
          )}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← ย้อน
        </Button>
        <Button onClick={onNext} disabled={!effectiveFlow}>
          ถัดไป →
        </Button>
      </div>
    </Card>
  );
}
