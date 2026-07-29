import { useEffect, useState } from 'react';
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
  interestRate?: string;
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
  const [buybackPrice, setBuybackPrice] = useState('');
  const [deviceCondition, setDeviceCondition] = useState('B');
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  const [newTotalMonths, setNewTotalMonths] = useState('12');
  const [newInterestRate, setNewInterestRate] = useState('');

  const contractQ = useQuery<OldContract>({
    queryKey: ['exchange-contract', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}`);
      return data;
    },
    enabled: !!contractId,
  });

  useEffect(() => {
    if (contractQ.data?.interestRate && !newInterestRate) {
      setNewInterestRate(contractQ.data.interestRate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractQ.data?.interestRate]);

  const replacementsQ = useQuery<ReplacementProduct[]>({
    queryKey: ['exchange-replacements-all', contractQ.data?.product.id],
    queryFn: async () => {
      const p = contractQ.data!.product;
      const qs = new URLSearchParams({
        status: 'IN_STOCK',
      });
      const { data } = await api.get(`/products?${qs.toString()}&limit=200`);
      const rows: ReplacementProduct[] = data.data ?? data ?? [];
      return rows.filter((r) => r.id !== p.id);
    },
    enabled: !!contractQ.data,
  });

  const previewQ = useQuery<{
    mode: 'MEMO' | 'PRICED' | null;
    ncv: string; grossRemainingInclVat: string;
    basePrice: string | null; marketMin: string | null; marketCheckPct: number;
    tier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null;
    expectedPl: string | null;
    plan: { financedAmount: string; storeCommission: string; interestTotal: string; vatAmount: string; monthlyPayment: string } | null;
    blockers: { overdueBlocked: boolean; advanceBlocked: boolean };
    hasUnpaidLateFee: boolean;
  }>({
    queryKey: ['exchange-preview', contractId, newProductId, buybackPrice, deviceCondition, newTotalMonths, newInterestRate],
    queryFn: async () => {
      const qs = new URLSearchParams({ oldContractId: contractId });
      if (newProductId) qs.set('newProductId', newProductId);
      if (buybackPrice) qs.set('buybackPrice', buybackPrice);
      if (deviceCondition) qs.set('deviceCondition', deviceCondition);
      if (newTotalMonths) qs.set('newTotalMonths', newTotalMonths);
      if (newInterestRate) qs.set('newInterestRate', newInterestRate);
      return (await api.get(`/insurance/exchange-requests/preview?${qs}`)).data;
    },
    enabled: !!contractId,
  });
  const isMemo = previewQ.data?.mode === 'MEMO';

  const submitM = useMutation({
    mutationFn: async () => {
      const res = await api.post('/insurance/exchange-requests', {
        oldContractId: contractId,
        oldProductId: contractQ.data!.product.id,
        newProductId,
        conditionNote: conditionNote.trim() || undefined,
        ...(isMemo
          ? {}
          : {
              buybackPrice,
              deviceCondition,
              depositAccountCode,
              newTotalMonths: parseInt(newTotalMonths, 10),
              newInterestRate,
            }),
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
        title="เปลี่ยนเครื่อง"
        subtitle="รุ่นเดิมราคาเดิม = ไม่มีรายการบัญชี / ต่างรุ่น-ต่างราคา = ตีราคารับซื้อ"
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
          ทุกรุ่นที่มีในสต็อก — รุ่นเดิมราคาเดิม = ไม่มีรายการบัญชี, ต่างรุ่น/ราคา = ต้องตีราคารับซื้อ
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
              ไม่มีเครื่องในสต็อกขณะนี้
            </p>
          )}
        </QueryBoundary>

        {/* Blockers จาก preview */}
        {previewQ.data?.blockers.overdueBlocked && (
          <p className="text-xs text-destructive leading-snug">⛔ มีงวดค้างชำระ — เคลียร์ก่อนเปลี่ยนเครื่อง</p>
        )}
        {previewQ.data?.blockers.advanceBlocked && (
          <p className="text-xs text-destructive leading-snug">⛔ มีเงินรับล่วงหน้า/เครดิตค้าง — ใช้หรือคืนก่อนเปลี่ยนเครื่อง</p>
        )}
        {previewQ.data?.hasUnpaidLateFee && (
          <p className="text-xs text-warning leading-snug">⚠ มีค่าปรับล่าช้าค้างเก็บ — แนะนำเก็บก่อนเปลี่ยนเครื่อง</p>
        )}

        {newProductId && isMemo && (
          <Card className="p-4 bg-primary/5 border-primary/30 text-sm leading-snug">
            รุ่นเดิม + ราคาเดิม → <strong>เปลี่ยนแบบไม่มีรายการบัญชี (MEMO)</strong> — สัญญาเดิมผ่อนต่อ ตารางเดิม
            ไม่ต้องตีราคา (ตอนอนุมัติต้องยืนยันบันทึกแนบท้าย + สลับ MDM)
          </Card>
        )}

        {newProductId && previewQ.data?.mode === 'PRICED' && (
          <div className="space-y-3 border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold leading-snug">ตีราคารับซื้อเครื่องเดิม</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">ราคารับซื้อ (บาท)</label>
                <input type="number" min="1" value={buybackPrice} onChange={(e) => setBuybackPrice(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">สภาพเครื่อง</label>
                <select value={deviceCondition} onChange={(e) => setDeviceCondition(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm">
                  {['A', 'B', 'C', 'D'].map((c) => <option key={c} value={c}>เกรด {c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">จำนวนงวดสัญญาใหม่</label>
                <input type="number" min="1" max="48" value={newTotalMonths} onChange={(e) => setNewTotalMonths(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">บัญชีรับ/จ่ายเงิน</label>
                <select value={depositAccountCode} onChange={(e) => setDepositAccountCode(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm">
                  {['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">อัตราดอกเบี้ย/เดือน</label>
                <input type="number" min="0" max="0.15" step="0.01" value={newInterestRate}
                  onChange={(e) => setNewInterestRate(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm" />
              </div>
            </div>

            {previewQ.data.tier && (
              <div className="flex items-center gap-2 text-sm leading-snug">
                <span className={
                  previewQ.data.tier === 'AUTO' ? 'inline-flex rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-medium'
                  : previewQ.data.tier === 'REVIEW' ? 'inline-flex rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium'
                  : 'inline-flex rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-xs font-medium'
                }>
                  {previewQ.data.tier === 'AUTO' ? 'อนุมัติอัตโนมัติ' : previewQ.data.tier === 'REVIEW' ? 'ผจก.สาขาอนุมัติ' : 'ผจก.ใหญ่อนุมัติ'}
                </span>
                <span className="text-xs text-muted-foreground">
                  NCV ฿{previewQ.data.ncv}{previewQ.data.marketMin ? ` · ราคากลางขั้นต่ำ ฿${previewQ.data.marketMin}` : ' · ไม่มีราคากลางรุ่นนี้'}
                </span>
              </div>
            )}

            {previewQ.data.expectedPl && (
              <p className={`text-sm leading-snug ${previewQ.data.expectedPl.startsWith('-') ? 'text-destructive' : 'text-primary'}`}>
                {previewQ.data.expectedPl.startsWith('-')
                  ? `ขาดทุนจากการเปลี่ยนเครื่อง (51-1102): ฿${previewQ.data.expectedPl.slice(1)}`
                  : `กำไรจากการเปลี่ยนเครื่อง (41-1102): ฿${previewQ.data.expectedPl}`}
              </p>
            )}

            {previewQ.data.plan && (
              <div className="text-xs text-muted-foreground leading-snug">
                สัญญาใหม่: ฿{previewQ.data.plan.financedAmount} · ดอกเบี้ย ฿{previewQ.data.plan.interestTotal} · VAT ฿{previewQ.data.plan.vatAmount} → ค่างวด <strong className="text-foreground">฿{previewQ.data.plan.monthlyPayment}</strong>/งวด
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground">หมายเหตุ (ไม่บังคับ)</label>
          <textarea
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            placeholder="เช่น สภาพเครื่องเก่า ฯลฯ"
            className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm min-h-[60px]"
          />
        </div>

        {isMemo && (
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
        )}

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => submitM.mutate()}
            disabled={
              !newProductId ||
              submitM.isPending ||
              previewQ.data?.blockers.overdueBlocked ||
              previewQ.data?.blockers.advanceBlocked ||
              (previewQ.data?.mode === 'PRICED' && !buybackPrice)
            }
          >
            {submitM.isPending ? 'กำลังส่ง…' : 'ส่งคำขออนุมัติ →'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
