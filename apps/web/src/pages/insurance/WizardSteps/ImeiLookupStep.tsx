import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Lock, Wrench, ArrowLeftRight, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type LookupResult =
  | { found: false }
  | {
      found: true;
      product: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string };
      sale: { id: string; saleType: 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE' } | null;
      customer: { id: string; name: string; phone: string } | null;
      contract: { id: string; contractNumber: string; status: string } | null;
      warrantyStatus: string | null;
      daysRemainingIn7Day: number | null;
      purchasedAt: string | null;
      shopWarrantyEndDate: string | null;
      manufacturerWarrantyEndDate: string | null;
    };

export interface ImeiLookupStepProps {
  onRepairChosen: (result: Extract<LookupResult, { found: true }>) => void;
  presetImei?: string;
}

export function ImeiLookupStep({ onRepairChosen, presetImei }: ImeiLookupStepProps) {
  const [imei, setImei] = useState(presetImei ?? '');
  const [result, setResult] = useState<LookupResult | null>(null);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (q: string) => {
      const { data } = await api.get<LookupResult>('/repair-tickets/lookup-by-imei', {
        params: { imei: q },
      });
      return data;
    },
    onSuccess: (data) => setResult(data),
    onError: () => toast.error('ค้นหาไม่สำเร็จ ลองอีกครั้ง'),
  });

  const handleLookup = () => {
    if (imei.trim().length < 4) {
      toast.error('IMEI ต้องอย่างน้อย 4 ตัวอักษร');
      return;
    }
    mutation.mutate(imei.trim());
  };

  const handleExchange = () => {
    if (!result || !result.found || !result.sale) return;
    if (result.sale.saleType === 'CASH') {
      // /trade-in (list page) — direct-deep-link to a new trade-in form is SP2 scope.
      // Pre-fill customer + product via query so the trade-in page can pick them up.
      const qs = new URLSearchParams();
      if (result.customer?.id) qs.set('customerId', result.customer.id);
      qs.set('productId', result.product.id);
      navigate(`/trade-in?${qs.toString()}`);
    } else if (result.sale.saleType === 'INSTALLMENT' && result.contract) {
      navigate(`/defect-exchange?contractId=${result.contract.id}`);
    }
    // EXTERNAL_FINANCE handled by disabled button
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <ScanLine className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold leading-snug">สแกน IMEI / Serial</h2>
      </div>
      <div className="flex gap-2">
        <Input
          value={imei}
          onChange={(e) => setImei(e.target.value)}
          placeholder="359123456789012"
          className="font-mono"
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
        />
        <Button onClick={handleLookup} disabled={mutation.isPending}>
          {mutation.isPending ? 'กำลังค้น…' : 'ค้นหา'}
        </Button>
      </div>

      {result && !result.found && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center">
          <Lock className="size-8 mx-auto mb-2 text-destructive" />
          <p className="font-medium text-destructive">ไม่พบเครื่องในระบบ</p>
          <p className="text-sm text-muted-foreground mt-1">
            เครื่องนี้ไม่ได้ขายจากร้าน — รับซ่อมเฉพาะเครื่องที่ขายจาก BESTCHOICE
          </p>
        </div>
      )}

      {result && result.found && (
        <>
          <PreviewCard result={result} />
          <ActionButtons
            result={result}
            onRepair={() => onRepairChosen(result)}
            onExchange={handleExchange}
          />
        </>
      )}
    </Card>
  );
}

function PreviewCard({ result }: { result: Extract<LookupResult, { found: true }> }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3">
      <Field label="ลูกค้า" value={result.customer?.name ?? '—'} subvalue={result.customer?.phone} />
      <Field
        label="สัญญา"
        value={result.contract?.contractNumber ?? '—'}
        subvalue={result.contract?.status}
      />
      <Field
        label="เครื่อง"
        value={`${result.product.brand} ${result.product.model}`}
        subvalue={`${result.product.storage ?? ''} · ${result.product.imeiSerial}`}
      />
      <Field
        label="ประกัน"
        value={warrantyLabel(result.warrantyStatus)}
        subvalue={
          result.daysRemainingIn7Day != null
            ? `เหลือ ${result.daysRemainingIn7Day} วัน (ประกันร้าน 7 วัน)`
            : undefined
        }
      />
      <Field
        label="ช่องทาง"
        value={channelLabel(result.sale?.saleType)}
        subvalue={channelSubtitle(result.sale?.saleType)}
      />
      <Field
        label="วันที่ซื้อ"
        value={formatThaiDate(result.purchasedAt)}
      />
      <Field
        label="ประกันหมด"
        value={formatThaiDate(
          result.manufacturerWarrantyEndDate ?? result.shopWarrantyEndDate,
        )}
        subvalue={warrantyEndSubtitle(result)}
      />
    </div>
  );
}

function formatThaiDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // วันที่ พ.ศ.: dd/MM/yyyy where yyyy = christian year + 543
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yy}`;
}

function warrantyEndSubtitle(
  result: Extract<LookupResult, { found: true }>,
): string | undefined {
  const hasShop = !!result.shopWarrantyEndDate;
  const hasMfr = !!result.manufacturerWarrantyEndDate;
  if (hasMfr && hasShop) return `ประกันโรงงาน (ร้านหมด ${formatThaiDate(result.shopWarrantyEndDate)})`;
  if (hasMfr) return 'ประกันโรงงาน';
  if (hasShop) return 'ประกันร้าน';
  return undefined;
}

function Field({ label, value, subvalue }: { label: string; value: string; subvalue?: string | null }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium leading-snug">{value}</div>
      {subvalue && <div className="text-xs text-muted-foreground leading-snug mt-0.5">{subvalue}</div>}
    </div>
  );
}

function ActionButtons({
  result,
  onRepair,
  onExchange,
}: {
  result: Extract<LookupResult, { found: true }>;
  onRepair: () => void;
  onExchange: () => void;
}) {
  const exchangeDisabled =
    !result.sale ||
    result.sale.saleType === 'EXTERNAL_FINANCE';

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Button onClick={onRepair} className="flex items-center gap-2">
        <Wrench className="size-4" /> รับเข้าซ่อม
      </Button>
      <Button
        variant="outline"
        onClick={onExchange}
        disabled={exchangeDisabled}
        title={exchangeDisabled ? 'ผ่อนกับ GFIN — ติดต่อ GFIN เพื่อปิดสัญญาก่อน' : undefined}
        className="flex items-center gap-2"
      >
        <ArrowLeftRight className="size-4" /> เปลี่ยนเครื่อง
      </Button>
    </div>
  );
}

function warrantyLabel(status: string | null): string {
  switch (status) {
    case 'IN_7DAY_DEFECT': return 'ประกันร้าน 7 วัน';
    case 'IN_SHOP_WARRANTY': return 'ประกันร้าน';
    case 'IN_MANUFACTURER': return 'ประกันโรงงาน';
    case 'OUT_OF_WARRANTY': return 'หมดประกัน';
    default: return '—';
  }
}

function channelLabel(saleType?: string | null): string {
  switch (saleType) {
    case 'CASH': return 'ซื้อสด';
    case 'INSTALLMENT': return 'BC FINANCE';
    case 'EXTERNAL_FINANCE': return 'GFIN';
    default: return 'ไม่ระบุ';
  }
}

function channelSubtitle(saleType?: string | null): string | undefined {
  if (saleType === 'EXTERNAL_FINANCE') return 'ผ่อนภายนอก — exchange ไม่ได้';
  return undefined;
}
