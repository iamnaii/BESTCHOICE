import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

interface OldContract {
  id: string;
  contractNumber: string;
  status: string;
  totalMonths: number;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string };
  product: {
    id: string;
    brand: string;
    model: string;
    storage: string | null;
    installmentPrice: string | null;
    cashPrice: string | null;
    sellingPrice?: string | null;
    imeiSerial: string | null;
  };
}

interface ReplacementProduct {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  imeiSerial: string | null;
  installmentPrice: string | null;
  cashPrice: string | null;
  sellingPrice?: string | null;
  status: string;
}

// Product price helper: Product schema has cashPrice + installmentPrice (both nullable).
// For SP2 same-price filter we use installmentPrice as the comparison.
function resolvePrice(p: { installmentPrice?: string | null; sellingPrice?: string | null }) {
  return p.installmentPrice ?? p.sellingPrice ?? null;
}

export default function ExchangeRequestForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const contractId = params.get('contractId') ?? '';
  const [newProductId, setNewProductId] = useState('');
  const [conditionNote, setConditionNote] = useState('');

  const contractQ = useQuery<OldContract>({
    queryKey: ['exchange-contract', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}`);
      return data;
    },
    enabled: !!contractId,
  });

  const replacementsQ = useQuery<ReplacementProduct[]>({
    queryKey: ['exchange-replacements', contractQ.data?.product.id],
    queryFn: async () => {
      const p = contractQ.data!.product;
      const qs = new URLSearchParams({
        status: 'IN_STOCK',
        brand: p.brand,
      });
      const { data } = await api.get(`/products?${qs.toString()}&limit=200`);
      const rows: ReplacementProduct[] = data.data ?? data ?? [];
      const oldPrice = resolvePrice(p);
      return rows.filter(
        (r) =>
          r.id !== p.id &&
          r.brand === p.brand &&
          r.model === p.model &&
          r.storage === p.storage &&
          resolvePrice(r) === oldPrice,
      );
    },
    enabled: !!contractQ.data,
  });

  const submitM = useMutation({
    mutationFn: async () => {
      const res = await api.post('/insurance/exchange-requests', {
        oldContractId: contractId,
        oldProductId: contractQ.data!.product.id,
        newProductId,
        conditionNote: conditionNote.trim() || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success(
        'ส่งคำขอเปลี่ยนเครื่องสำเร็จ — รออนุมัติจาก OWNER (จากนั้นลูกค้าต้องลงนามสัญญาใหม่)',
      );
      navigate('/insurance');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!contractId) {
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-destructive">ต้องระบุ contractId ใน URL</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="เปลี่ยนเครื่อง (ราคาเท่าเดิม)"
        subtitle="ลูกค้าผ่อนงวดที่เหลือต่อ ไม่จ่ายเงินเพิ่ม"
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/insurance')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> กลับ
          </Button>
        }
      />

      <QueryBoundary
        isLoading={contractQ.isLoading}
        isError={contractQ.isError}
        error={contractQ.error}
        onRetry={contractQ.refetch}
      >
        {contractQ.data && (
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold leading-snug">ข้อมูลสัญญาเดิม</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">สัญญา:</span>{' '}
                <span className="font-mono">{contractQ.data.contractNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ลูกค้า:</span> {contractQ.data.customer.name}
              </div>
              <div>
                <span className="text-muted-foreground">เครื่อง:</span>{' '}
                {contractQ.data.product.brand} {contractQ.data.product.model}{' '}
                {contractQ.data.product.storage}
              </div>
              <div>
                <span className="text-muted-foreground">ราคา:</span>{' '}
                ฿{resolvePrice(contractQ.data.product) ?? '—'}
              </div>
            </div>
          </Card>
        )}
      </QueryBoundary>

      <Card className="p-6 space-y-4">
        <h2 className="text-base font-semibold leading-snug">เลือกเครื่องทดแทน</h2>
        <p className="text-xs text-muted-foreground leading-snug">
          เฉพาะรุ่น / ความจุ / ราคาเดียวกัน ที่อยู่ในสต็อก
        </p>
        <QueryBoundary
          isLoading={replacementsQ.isLoading}
          isError={replacementsQ.isError}
          error={replacementsQ.error}
          onRetry={replacementsQ.refetch}
        >
          <select
            value={newProductId}
            onChange={(e) => setNewProductId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg bg-background text-sm"
          >
            <option value="">-- เลือกเครื่องทดแทน --</option>
            {(replacementsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.model} {p.storage}{' '}
                {p.color ? `(${p.color})` : ''} — IMEI {p.imeiSerial ?? '—'}
              </option>
            ))}
          </select>
          {replacementsQ.data && replacementsQ.data.length === 0 && (
            <p className="text-xs text-destructive leading-snug">
              ไม่มีสต็อกรุ่น/ราคาเดียวกันในขณะนี้
            </p>
          )}
        </QueryBoundary>

        <div>
          <label className="text-xs text-muted-foreground">หมายเหตุ (ไม่บังคับ)</label>
          <textarea
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            placeholder="เช่น สภาพเครื่องเก่า ฯลฯ"
            className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm min-h-[60px]"
          />
        </div>

        <Card className="p-4 bg-primary/5 border-primary/30">
          <div className="flex gap-2 items-start text-sm leading-snug">
            <CheckCircle2 className="size-4 text-primary mt-0.5" />
            <div>
              <strong>ลูกค้าไม่จ่ายเงินเพิ่ม</strong> — สัญญาใหม่ผ่อนต่อจากเดิม งวดละเท่าเดิม
              <div className="mt-1 text-xs text-muted-foreground">
                หลังอนุมัติ ลูกค้าต้องลงนามสัญญาใหม่ก่อนจึงจะใช้งานได้
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => submitM.mutate()}
            disabled={!newProductId || submitM.isPending}
          >
            {submitM.isPending ? 'กำลังส่ง…' : 'ส่งคำขออนุมัติ →'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
