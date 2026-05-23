import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

interface DefectExchangePageProps {
  /** Pre-select a contract when mounted from within the insurance wizard. */
  presetContractId?: string;
  /** Skip the 7-day window eligibility check (wizard: repair-ticket exit path). */
  bypassWindow?: boolean;
  /** Repair ticket ID that triggered this exchange (required when bypassWindow=true). */
  originRepairTicketId?: string;
}

interface ContractRow {
  id: string;
  contractNumber: string;
  status: string;
  createdAt: string;
  deviceReceivedAt: string | null;
  shopWarrantyStartDate: string | null;
  customer: { id: string; name: string };
  product: { id: string; name: string; brand: string; model: string; storage: string | null; category: string };
}

interface ProductRow {
  id: string;
  name: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  status: string;
  category: string;
  imeiSerial: string | null;
}

interface Eligibility {
  eligible: boolean;
  reasons: string[];
  daysRemaining: number;
  windowEnd: string;
  oldContract: {
    id: string;
    contractNumber: string;
    product: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null };
    paidAmount: number;
  };
  newProduct: { id: string; brand: string; model: string; storage: string | null; category: string; status: string } | null;
  supplierClaimEligible: boolean;
}

interface HistoryRow {
  id: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null } | null;
  newValue: {
    oldContractNumber: string;
    newContractNumber: string;
    defectReason: string;
    transferredCredit: number;
    supplierClaimEligible: boolean;
  };
}

export default function DefectExchangePage(props?: DefectExchangePageProps) {
  const [params] = useSearchParams();

  // Resolve effective values: explicit props win, then URL query params, then defaults.
  const presetContractId =
    props?.presetContractId ?? params.get('contractId') ?? undefined;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canExecute = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  // Role-gate the URL-derived bypass: a SALES user crafting ?bypassWindow=true
  // must not propagate the flag to the API. canExecute acts as the FE guard;
  // the backend also enforces this server-side (defence in depth).
  const bypassWindowRaw =
    props?.bypassWindow ?? params.get('bypassWindow') === 'true';
  const bypassWindow = bypassWindowRaw && canExecute;

  const originRepairTicketId =
    props?.originRepairTicketId ?? params.get('originRepairTicketId') ?? undefined;

  const [selectedContractId, setSelectedContractId] = useState(presetContractId ?? '');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [defectReason, setDefectReason] = useState('');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  // Wizard step (mirrors CreateInsuranceWizardPage pattern): 1 = contract,
  // 2 = replacement device, 3 = defect + confirm. If preset contract supplied
  // (came from IMEI wizard), no need to dwell on step 1 — start at step 2.
  const [step, setStep] = useState<1 | 2 | 3>(presetContractId ? 2 : 1);

  const contractsQ = useQuery<ContractRow[]>({
    queryKey: ['defect-exchange-contracts', presetContractId ?? null],
    queryFn: async () => {
      const { data } = await api.get('/contracts?status=ACTIVE&limit=200');
      const rows: ContractRow[] = data.data || [];
      // Always include the preset contract (even if PHONE_NEW / outside filter) so
      // the user sees the contract they came from. Eligibility check below will
      // surface any rule violations as readable reasons — better than an empty
      // dropdown that gives no feedback.
      return rows.filter(
        (c) => c.product.category === 'PHONE_USED' || c.id === presetContractId,
      );
    },
  });

  const productsQ = useQuery<ProductRow[]>({
    queryKey: ['defect-exchange-products'],
    queryFn: async () => (await api.get('/products?status=IN_STOCK&category=PHONE_USED&limit=200')).data.data || [],
  });

  const eligibilityQ = useQuery<Eligibility>({
    queryKey: ['defect-exchange-eligibility', selectedContractId, selectedProductId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProductId) params.set('newProductId', selectedProductId);
      const { data } = await api.get(`/defect-exchange/eligibility/${selectedContractId}?${params}`);
      return data;
    },
    enabled: !!selectedContractId,
  });

  const historyQ = useQuery<HistoryRow[]>({
    queryKey: ['defect-exchange-history'],
    queryFn: async () => (await api.get('/defect-exchange')).data,
  });

  // Narrow replacement products to same brand+model+storage
  const matchingProducts = useMemo(() => {
    const selected = contractsQ.data?.find((c) => c.id === selectedContractId);
    if (!selected) return [];
    return (productsQ.data || []).filter(
      (p) =>
        p.brand === selected.product.brand &&
        p.model === selected.product.model &&
        (p.storage ?? null) === (selected.product.storage ?? null),
    );
  }, [contractsQ.data, productsQ.data, selectedContractId]);

  const executeM = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/defect-exchange/execute', {
        oldContractId: selectedContractId,
        newProductId: selectedProductId,
        defectReason,
        notes: notes || undefined,
        // Wizard bypass path: skip 7-day window check when coming from a repair ticket.
        ...(bypassWindow && { bypassWindowCheck: true }),
        ...(originRepairTicketId && { originRepairTicketId }),
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`เปลี่ยนเครื่องสำเร็จ — สัญญาใหม่ ${data.newContract.contractNumber}`);
      queryClient.invalidateQueries({ queryKey: ['defect-exchange-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['defect-exchange-products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-exchange-history'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      setSelectedContractId('');
      setSelectedProductId('');
      setDefectReason('');
      setNotes('');
      setShowConfirm(false);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
      setShowConfirm(false);
    },
  });

  const elig = eligibilityQ.data;
  const selectedContract = contractsQ.data?.find((c) => c.id === selectedContractId);

  // Step validation gates
  const canNextFrom1 = !!selectedContractId && (elig?.eligible || bypassWindow);
  const canNextFrom2 = !!selectedProductId;
  const canSubmit = !!selectedProductId && !!defectReason.trim() && (elig?.eligible || bypassWindow);

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="เปลี่ยนเครื่อง (ประกันร้าน 7 วัน)"
        subtitle={undefined}
        breadcrumb={
          <div className="flex gap-2 text-sm flex-wrap">
            <span className={step === 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              1. สัญญา
            </span>
            <span className="text-muted-foreground">→</span>
            <span className={step === 2 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              2. เลือกเครื่อง
            </span>
            <span className="text-muted-foreground">→</span>
            <span className={step === 3 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              3. ยืนยัน
            </span>
          </div>
        }
        action={
          step > 1 && !presetContractId ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              เริ่มใหม่
            </Button>
          ) : undefined
        }
      />

      {/* Step 1 — Contract */}
      {step === 1 && (
        <Card className="p-6 space-y-4">
          <div className="text-sm font-semibold">1. เลือกสัญญาเดิม</div>
          <QueryBoundary isLoading={contractsQ.isLoading} isError={contractsQ.isError} error={contractsQ.error} onRetry={contractsQ.refetch}>
            <select
              value={selectedContractId}
              onChange={(e) => {
                setSelectedContractId(e.target.value);
                setSelectedProductId('');
              }}
              disabled={!!presetContractId}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <option value="">-- เลือกสัญญา --</option>
              {contractsQ.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} — {c.customer.name} — {c.product.brand} {c.product.model} {c.product.storage ?? ''}
                </option>
              ))}
            </select>
          </QueryBoundary>

          {selectedContract && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
              <div><span className="text-muted-foreground">ลูกค้า:</span> {selectedContract.customer.name}</div>
              <div><span className="text-muted-foreground">เครื่องเดิม:</span> {selectedContract.product.brand} {selectedContract.product.model} {selectedContract.product.storage ?? ''}</div>
              <div><span className="text-muted-foreground">วันรับเครื่อง:</span> {(selectedContract.deviceReceivedAt || selectedContract.shopWarrantyStartDate || selectedContract.createdAt).slice(0, 10)}</div>
            </div>
          )}

          {elig && (
            <div
              className={`rounded-lg border p-3 text-xs ${
                elig.eligible
                  ? 'bg-success/5 border-success/30 text-success'
                  : 'bg-destructive/5 border-destructive/30 text-destructive'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold mb-1">
                {elig.eligible ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                {elig.eligible ? `เข้าเกณฑ์ — เหลือ ${elig.daysRemaining} วัน` : 'ไม่เข้าเกณฑ์'}
              </div>
              {!elig.eligible && (
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  {elig.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {elig.eligible && elig.supplierClaimEligible && (
                <div className="mt-2 flex items-center gap-1 text-primary">
                  <ShieldCheck className="size-3.5" />
                  เครื่องเดิมยังอยู่ในประกัน supplier — เคลมคืนได้
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="primary"
              disabled={!canNextFrom1}
              title={!canNextFrom1 ? 'ไม่ผ่านเกณฑ์เปลี่ยนเครื่อง' : undefined}
              onClick={() => setStep(2)}
            >
              ต่อไป <ArrowRight className="size-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2 — Replacement device */}
      {step === 2 && (
        <Card className="p-6 space-y-4">
          <div className="text-sm font-semibold">2. เลือกเครื่องทดแทน (รุ่น/ความจุเดียวกัน)</div>
          {selectedContract && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">สำหรับสัญญา:</span>{' '}
              <span className="font-mono">{selectedContract.contractNumber}</span> —{' '}
              {selectedContract.product.brand} {selectedContract.product.model} {selectedContract.product.storage ?? ''}
            </div>
          )}
          <QueryBoundary isLoading={productsQ.isLoading} isError={productsQ.isError} error={productsQ.error} onRetry={productsQ.refetch}>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
            >
              <option value="">-- เลือกเครื่องทดแทน --</option>
              {matchingProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.model} {p.storage ?? ''} {p.color ? `(${p.color})` : ''} — IMEI {p.imeiSerial ?? 'ยังไม่ระบุ'}
                </option>
              ))}
            </select>
            {matchingProducts.length === 0 && (
              <div className="text-xs text-destructive mt-2">ไม่มีสต็อกรุ่น/ความจุเดียวกันในขณะนี้</div>
            )}
          </QueryBoundary>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setStep(1)}>กลับ</Button>
            <Button
              variant="primary"
              disabled={!canNextFrom2}
              onClick={() => setStep(3)}
            >
              ต่อไป <ArrowRight className="size-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3 — Defect description + confirm */}
      {step === 3 && (
        <Card className="p-6 space-y-4">
          <div className="text-sm font-semibold">3. อาการเครื่องเสีย + ยืนยัน</div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">สัญญาเดิม:</span> <span className="font-mono">{selectedContract?.contractNumber}</span></div>
            <div><span className="text-muted-foreground">เครื่องใหม่:</span> {matchingProducts.find((p) => p.id === selectedProductId)?.brand} {matchingProducts.find((p) => p.id === selectedProductId)?.model}</div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">อาการเครื่องเสีย *</div>
            <textarea
              value={defectReason}
              onChange={(e) => setDefectReason(e.target.value)}
              placeholder="เช่น หน้าจอกระพริบ, เครื่องดับเอง, แบตหมดไว..."
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background min-h-[80px]"
            />
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">หมายเหตุเพิ่มเติม</div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
            />
          </div>

          {!canExecute && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              เฉพาะ OWNER / BRANCH_MANAGER เท่านั้นที่อนุมัติเปลี่ยนเครื่องได้
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setStep(2)}>กลับ</Button>
            {canExecute && (
              <Button
                variant="primary"
                disabled={!canSubmit || executeM.isPending}
                onClick={() => setShowConfirm(true)}
              >
                ดำเนินการเปลี่ยนเครื่อง <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* History (always visible at bottom for context) */}
      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">ประวัติการเปลี่ยนเครื่องล่าสุด</div>
        <QueryBoundary isLoading={historyQ.isLoading} isError={historyQ.isError} error={historyQ.error} onRetry={historyQ.refetch}>
          {historyQ.data && historyQ.data.length > 0 ? (
            <div className="space-y-2">
              {historyQ.data.map((h) => (
                <div key={h.id} className="rounded-lg border border-border/60 bg-card p-3 text-xs">
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold">
                        {h.newValue.oldContractNumber} → {h.newValue.newContractNumber}
                      </div>
                      <div className="text-muted-foreground mt-1">{h.newValue.defectReason}</div>
                      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span>{new Date(h.createdAt).toLocaleString('th-TH')}</span>
                        <span>โดย {h.user?.name ?? h.user?.email ?? '—'}</span>
                      </div>
                    </div>
                    {h.newValue.supplierClaimEligible && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                        <ShieldCheck className="size-3" />
                        claim ได้
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-8">ยังไม่มีประวัติ</div>
          )}
        </QueryBoundary>
      </Card>

      {/* Confirmation modal */}
      {showConfirm && elig?.eligible && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl max-w-md w-full p-6">
            <div className="text-lg font-semibold mb-3">ยืนยันการเปลี่ยนเครื่อง</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">สัญญาเดิม:</span>
                <span className="font-mono">{elig.oldContract.contractNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">เครื่องเดิม (IMEI):</span>
                <span className="font-mono text-xs">{elig.oldContract.product.imeiSerial ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">เครื่องใหม่:</span>
                <span>{elig.newProduct?.brand} {elig.newProduct?.model} {elig.newProduct?.storage ?? ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">เครดิตที่โอนไปสัญญาใหม่:</span>
                <span className="tabular-nums font-mono">{formatNumber(elig.oldContract.paidAmount)} บาท</span>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-warning/5 border border-warning/30 text-xs text-warning">
              <AlertTriangle className="size-3.5 inline mr-1" />
              ลูกค้าต้องเซ็นสัญญาใหม่ที่ร้านก่อนรับเครื่อง (เพื่อยืนยัน IMEI ใหม่ตามกฎหมาย)
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setShowConfirm(false)} disabled={executeM.isPending}>
                ยกเลิก
              </Button>
              <Button variant="primary" size="lg" className="flex-1" onClick={() => executeM.mutate()} disabled={executeM.isPending}>
                {executeM.isPending ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
