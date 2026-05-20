import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
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
  const bypassWindow =
    props?.bypassWindow ?? params.get('bypassWindow') === 'true';
  const originRepairTicketId =
    props?.originRepairTicketId ?? params.get('originRepairTicketId') ?? undefined;

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canExecute = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [selectedContractId, setSelectedContractId] = useState(presetContractId ?? '');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [defectReason, setDefectReason] = useState('');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const contractsQ = useQuery<ContractRow[]>({
    queryKey: ['defect-exchange-contracts'],
    queryFn: async () => {
      const { data } = await api.get('/contracts?status=ACTIVE&limit=200');
      const rows: ContractRow[] = data.data || [];
      return rows.filter((c) => c.product.category === 'PHONE_USED');
    },
  });

  const productsQ = useQuery<ProductRow[]>({
    queryKey: ['defect-exchange-products'],
    queryFn: async () => (await api.get('/products?status=IN_STOCK&category=PHONE_USED&limit=300')).data.data || [],
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

  return (
    <div>
      <PageHeader
        title="เปลี่ยนเครื่อง (ประกันร้าน 7 วัน)"
        subtitle="สำหรับมือสองที่มีตำหนิภายใน 7 วันแรกหลังรับเครื่อง"
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Form */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <div className="text-sm font-semibold mb-2">1. เลือกสัญญาเดิม</div>
              <QueryBoundary isLoading={contractsQ.isLoading} isError={contractsQ.isError} error={contractsQ.error} onRetry={contractsQ.refetch}>
                <select
                  value={selectedContractId}
                  onChange={(e) => {
                    setSelectedContractId(e.target.value);
                    setSelectedProductId('');
                  }}
                  // Lock picker when contract is pre-filled from wizard/props
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
            </div>

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

            <div>
              <div className="text-sm font-semibold mb-2">2. เลือกเครื่องทดแทน (รุ่น/ความจุเดียวกัน)</div>
              <QueryBoundary isLoading={productsQ.isLoading} isError={productsQ.isError} error={productsQ.error} onRetry={productsQ.refetch}>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  disabled={!selectedContractId}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background disabled:opacity-50"
                >
                  <option value="">-- เลือกเครื่องทดแทน --</option>
                  {matchingProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.brand} {p.model} {p.storage ?? ''} {p.color ? `(${p.color})` : ''} — IMEI {p.imeiSerial ?? 'ยังไม่ระบุ'}
                    </option>
                  ))}
                </select>
                {selectedContractId && matchingProducts.length === 0 && (
                  <div className="text-xs text-destructive mt-2">ไม่มีสต็อกรุ่น/ความจุเดียวกันในขณะนี้</div>
                )}
              </QueryBoundary>
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">3. อาการเครื่องเสีย</div>
              <textarea
                value={defectReason}
                onChange={(e) => setDefectReason(e.target.value)}
                placeholder="เช่น หน้าจอกระพริบ, เครื่องดับเอง, แบตหมดไว..."
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background min-h-[80px]"
              />
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">หมายเหตุเพิ่มเติม</div>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              />
            </div>

            {canExecute ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={
                  !elig?.eligible ||
                  !selectedProductId ||
                  !defectReason.trim() ||
                  executeM.isPending
                }
                onClick={() => setShowConfirm(true)}
              >
                ดำเนินการเปลี่ยนเครื่อง
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                เฉพาะ OWNER / BRANCH_MANAGER เท่านั้นที่อนุมัติเปลี่ยนเครื่องได้
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: History */}
        <Card>
          <CardContent className="p-5">
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
          </CardContent>
        </Card>
      </div>

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
