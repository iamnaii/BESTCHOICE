import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateShort } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

interface Repossession {
  id: string;
  repossessedDate: string;
  conditionGrade: string;
  appraisalPrice: string;
  repairCost: string;
  resellPrice: string | null;
  status: string;
  notes: string | null;
  contract: {
    id: string;
    contractNumber: string;
    sellingPrice: string;
    financedAmount: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null };
  appraisedBy: { id: string; name: string };
}

const statusLabels: Record<string, string> = {
  REPOSSESSED: 'ยึดคืนแล้ว',
  UNDER_REPAIR: 'กำลังซ่อม',
  READY_FOR_SALE: 'พร้อมขาย',
  SOLD: 'ขายแล้ว',
};

const statusColors: Record<string, string> = {
  REPOSSESSED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  UNDER_REPAIR: 'bg-warning/10 text-warning dark:bg-warning/15',
  READY_FOR_SALE: 'bg-success/10 text-success dark:bg-success/15',
  SOLD: 'bg-primary/10 text-primary dark:bg-primary/15',
};

const gradeColors: Record<string, string> = {
  A: 'bg-success/10 text-success dark:bg-success/15',
  B: 'bg-primary/10 text-primary dark:bg-primary/15',
  C: 'bg-warning/10 text-warning dark:bg-warning/15',
  D: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
};

export default function RepossessionsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repossession | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const [createForm, setCreateForm] = useState({
    contractId: '',
    repossessedDate: new Date().toISOString().split('T')[0],
    conditionGrade: 'C',
    appraisalPrice: '',
    repairCost: '0',
    notes: '',
    marketValue: '',
    discountPct: '50',
    customerRefundEnabled: false,
  });
  const [updateForm, setUpdateForm] = useState({
    repairCost: '',
    resellPrice: '',
    status: '',
    notes: '',
  });

  // Fetch contracts that can be repossessed (OVERDUE or DEFAULT)
  const { data: overdueContracts = [] } = useQuery<{ id: string; contractNumber: string; customer: { name: string }; product: { name: string } }[]>({
    queryKey: ['contracts-for-repo'],
    queryFn: async () => {
      const [overdue, defaulted] = await Promise.all([
        api.get('/contracts?status=OVERDUE'),
        api.get('/contracts?status=DEFAULT'),
      ]);
      return [...(overdue.data.data || []), ...(defaulted.data.data || [])];
    },
  });

  const {
    data: repos = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Repossession[]>({
    queryKey: ['repossessions', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return (await api.get(`/repossessions${params}`)).data;
    },
  });

  const { data: profitLoss } = useQuery({
    queryKey: ['repossessions-pl'],
    queryFn: async () => (await api.get('/repossessions/profit-loss')).data,
  });

  // Live P&L preview when creating
  const { data: previewData } = useQuery<{
    contract: { contractNumber: string; customer: { name: string }; product: { brand: string; model: string }; totalMonths: number; monthlyPayment: number; sellingPrice: number; financedAmount: number; storeCommission: number };
    calculation: { remainingMonths: number; totalPaid: number; outstandingBalance: number; principalExVat: number; financeCost: number; remainingCost: number; discountPct: number; discountAmount: number; closingAmount: number; marketValue: number; customerRefundEnabled: boolean; customerRefund: number; profitLoss: number };
  }>({
    queryKey: ['repossession-preview', createForm.contractId, createForm.marketValue, createForm.discountPct, createForm.customerRefundEnabled],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (createForm.marketValue) params.set('marketValue', createForm.marketValue);
      if (createForm.discountPct) params.set('discountPct', createForm.discountPct);
      params.set('customerRefundEnabled', String(createForm.customerRefundEnabled));
      return (await api.get(`/repossessions/preview/${createForm.contractId}?${params}`)).data;
    },
    enabled: !!createForm.contractId && isCreateModalOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => api.post('/repossessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      toast.success('บันทึกการยึดคืนสำเร็จ');
      setIsCreateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/repossessions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions-pl'] });
      toast.success('อัพเดทสำเร็จ');
      setIsUpdateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const readyForSaleMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/repossessions/${id}/ready-for-sale`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      toast.success('เปลี่ยนสถานะเป็น พร้อมขาย แล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openUpdate = (repo: Repossession) => {
    setSelectedRepo(repo);
    setUpdateForm({
      repairCost: repo.repairCost,
      resellPrice: repo.resellPrice || '',
      status: repo.status,
      notes: repo.notes || '',
    });
    setIsUpdateModalOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      contractId: createForm.contractId,
      repossessedDate: createForm.repossessedDate,
      conditionGrade: createForm.conditionGrade,
      appraisalPrice: Number(createForm.appraisalPrice),
      repairCost: Number(createForm.repairCost),
      notes: createForm.notes,
      marketValue: createForm.marketValue ? Number(createForm.marketValue) : undefined,
      discountPct: createForm.discountPct ? Number(createForm.discountPct) : 50,
      customerRefundEnabled: createForm.customerRefundEnabled,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;
    updateMutation.mutate({
      id: selectedRepo.id,
      data: {
        repairCost: Number(updateForm.repairCost),
        resellPrice: updateForm.resellPrice ? Number(updateForm.resellPrice) : undefined,
        status: updateForm.status,
        notes: updateForm.notes,
      },
    });
  };

  const columns = [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (r: Repossession) => (
        <div>
          <div className="font-medium text-primary">{r.contract.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{r.contract.customer.name}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (r: Repossession) => (
        <div className="text-sm">
          {r.product.brand} {r.product.model}
          {r.product.imeiSerial && (
            <div className="text-xs text-muted-foreground">{r.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'grade',
      label: 'สภาพ',
      render: (r: Repossession) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gradeColors[r.conditionGrade]}`}>
          เกรด {r.conditionGrade}
        </span>
      ),
    },
    {
      key: 'appraisalPrice',
      label: 'ราคาตี',
      render: (r: Repossession) => (
        <span className="text-sm">{Number(r.appraisalPrice).toLocaleString()} บาท</span>
      ),
    },
    {
      key: 'resellPrice',
      label: 'ราคาขาย',
      render: (r: Repossession) =>
        r.resellPrice ? (
          <span className="text-sm">{Number(r.resellPrice).toLocaleString()} บาท</span>
        ) : (
          <span className="text-xs text-muted-foreground">ยังไม่กำหนด</span>
        ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: Repossession) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status]}`}>
          {statusLabels[r.status]}
        </span>
      ),
    },
    {
      key: 'date',
      label: 'วันที่ยึด',
      render: (r: Repossession) => (
        <span className="text-sm">{formatDateShort(r.repossessedDate)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r: Repossession) => (
        <div className="flex items-center gap-2">
          {(r.status === 'REPOSSESSED' || r.status === 'UNDER_REPAIR') && (
            <button
              onClick={() => setConfirmDialog({ open: true, message: 'เปลี่ยนสถานะเป็น พร้อมขาย?', action: () => readyForSaleMutation.mutate(r.id) })}
              disabled={readyForSaleMutation.isPending}
              className="text-success hover:text-success/80 text-sm font-medium"
            >
              พร้อมขาย
            </button>
          )}
          <button
            onClick={() => openUpdate(r)}
            className="text-primary hover:text-primary/80 text-sm font-medium"
          >
            จัดการ
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ยึดคืน & ขายต่อ"
        subtitle="จัดการเครื่องที่ยึดคืนจากลูกค้า"
        action={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            + บันทึกการยึดคืน
          </button>
        }
      />

      {/* Profit/Loss Summary */}
      {profitLoss?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-5 lg:gap-7.5 mb-6">
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">เครื่องที่ขายแล้ว</div>
              <div className="text-2xl font-bold">{profitLoss.summary.count ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ราคาตีรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalAppraisal ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ค่าซ่อมรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalRepairCost ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ราคาขายรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalResellPrice ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">กำไร/ขาดทุน</div>
              <div className={`text-lg font-bold ${(profitLoss.summary.totalProfit ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                {(profitLoss.summary.totalProfit ?? 0).toLocaleString()} บาท
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Itemized P&L Table */}
      {(profitLoss?.items?.length ?? 0) > 0 && (
        <Card className="shadow-card mb-6 overflow-hidden">
          <CardHeader className="px-4 py-3 border-b bg-secondary">
            <h3 className="text-sm font-medium text-foreground">รายละเอียดกำไร/ขาดทุน</h3>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-secondary text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">สัญญา</th>
                  <th className="px-4 py-2 text-left">ลูกค้า</th>
                  <th className="px-4 py-2 text-left">สินค้า</th>
                  <th className="px-4 py-2 text-center">เกรด</th>
                  <th className="px-4 py-2 text-right">ราคาตี</th>
                  <th className="px-4 py-2 text-right">ค่าซ่อม</th>
                  <th className="px-4 py-2 text-right">ราคาขาย</th>
                  <th className="px-4 py-2 text-right">กำไร</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profitLoss?.items?.map((item: { id: string; contract: string; customer: string; product: string; conditionGrade: string; appraisalPrice: number; repairCost: number; resellPrice: number; profit: number; marginPct: string }) => (
                  <tr key={item.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 font-medium text-primary">{item.contract}</td>
                    <td className="px-4 py-2">{item.customer}</td>
                    <td className="px-4 py-2">{item.product}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gradeColors[item.conditionGrade] || ''}`}>
                        {item.conditionGrade}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{item.appraisalPrice.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.repairCost.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.resellPrice.toLocaleString()}</td>
                    <td className={`px-4 py-2 text-right font-medium ${item.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {item.profit.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Filter */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="REPOSSESSED">ยึดคืนแล้ว</option>
          <option value="UNDER_REPAIR">กำลังซ่อม</option>
          <option value="READY_FOR_SALE">พร้อมขาย</option>
          <option value="SOLD">ขายแล้ว</option>
        </select>
      </div>

      <QueryBoundary
        isLoading={isLoading && repos.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการยึดคืนได้"
      >
        <DataTable columns={columns} data={repos} isLoading={isLoading} emptyMessage="ยังไม่มีการยึดคืน" />
      </QueryBoundary>

      {/* Create Modal — full-screen overlay with live P&L breakdown */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-md flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="บันทึกการยึดคืน">
          <div className="w-full max-w-3xl bg-white dark:bg-slate-950 rounded-2xl shadow-2xl shadow-slate-900/10 overflow-hidden flex flex-col max-h-[calc(100vh-4rem)] ring-1 ring-slate-200/60 dark:ring-slate-800/60">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-gradient-to-b from-white to-slate-50/80 dark:from-slate-950 dark:to-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60 px-6 py-5 flex items-center justify-between shrink-0">
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                กลับ
              </button>
              <div className="text-center">
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">บันทึกการยึดคืนเครื่อง</h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">คำนวณกำไร/ขาดทุนแบบ real-time</p>
              </div>
              <div className="w-16" />
            </div>

            <form onSubmit={handleCreate} className="flex-1 overflow-y-auto flex flex-col bg-slate-50/40 dark:bg-slate-900/40">
              <div className="p-6 space-y-4 flex-1">

                {/* Section 1: เลือกสัญญา */}
                <div className="group rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950/60 p-5 shadow-sm hover:shadow-md hover:shadow-sky-500/5 hover:border-sky-200 dark:hover:border-sky-900/60 transition-all duration-300">
                  <div className="flex items-center gap-3.5 mb-5">
                    <div className="flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-sky-50 to-blue-100/80 dark:from-sky-950/60 dark:to-blue-900/40 text-sky-600 dark:text-sky-400 ring-1 ring-sky-100 dark:ring-sky-900/60 group-hover:scale-105 transition-transform">
                      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">เลือกสัญญา</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">เฉพาะสัญญาค้างชำระ/ผิดนัด</p>
                    </div>
                  </div>
                  <select
                    value={createForm.contractId}
                    onChange={(e) => setCreateForm({ ...createForm, contractId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-sky-300 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    required
                  >
                    <option value="">-- เลือกสัญญา --</option>
                    {overdueContracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contractNumber} - {c.customer.name} ({c.product.name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Section 2: ข้อมูลลูกค้า + สินค้า (auto from preview) */}
                {previewData && (
                  <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950/60 p-5 shadow-sm">
                    <div className="flex items-center gap-3.5 mb-4">
                      <div className="flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-100/80 dark:from-indigo-950/60 dark:to-violet-900/40 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-100 dark:ring-indigo-900/60">
                        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">สรุปข้อมูลสัญญา</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{previewData.contract.customer.name} · {previewData.contract.product.brand} {previewData.contract.product.model}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2.5">
                        <div className="text-slate-500 dark:text-slate-400">ค่างวด/เดือน</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{previewData.contract.monthlyPayment.toLocaleString()} ฿</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2.5">
                        <div className="text-slate-500 dark:text-slate-400">งวดทั้งหมด</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{previewData.contract.totalMonths} งวด</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2.5">
                        <div className="text-amber-700 dark:text-amber-400">งวดคงค้าง</div>
                        <div className="font-semibold text-amber-900 dark:text-amber-200 mt-0.5">{previewData.calculation.remainingMonths} งวด</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 3: รายละเอียดการยึด */}
                <div className="group rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950/60 p-5 shadow-sm hover:shadow-md hover:shadow-orange-500/5 hover:border-orange-200 dark:hover:border-orange-900/60 transition-all duration-300">
                  <div className="flex items-center gap-3.5 mb-5">
                    <div className="flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-orange-50 to-amber-100/80 dark:from-orange-950/60 dark:to-amber-900/40 text-orange-600 dark:text-orange-400 ring-1 ring-orange-100 dark:ring-orange-900/60 group-hover:scale-105 transition-transform">
                      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">รายละเอียดการยึด</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">วันที่ยึด สภาพ ราคาตี ค่าซ่อม</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">วันที่ยึดคืน <span className="text-rose-500">*</span></label>
                      <ThaiDateInput
                        value={createForm.repossessedDate}
                        onChange={(e) => setCreateForm({ ...createForm, repossessedDate: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-orange-300 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">สภาพเครื่อง <span className="text-rose-500">*</span></label>
                      <select
                        value={createForm.conditionGrade}
                        onChange={(e) => setCreateForm({ ...createForm, conditionGrade: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-orange-300 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      >
                        <option value="A">A - ดีมาก</option>
                        <option value="B">B - ดี</option>
                        <option value="C">C - พอใช้</option>
                        <option value="D">D - เสียหาย</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">ราคาตี (บาท) <span className="text-rose-500">*</span></label>
                      <input
                        type="number"
                        value={createForm.appraisalPrice}
                        onChange={(e) => setCreateForm({ ...createForm, appraisalPrice: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-orange-300 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                        placeholder="0"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">ค่าซ่อม (บาท)</label>
                      <input
                        type="number"
                        value={createForm.repairCost}
                        onChange={(e) => setCreateForm({ ...createForm, repairCost: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-orange-300 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: คำนวณยอดปิด + กำไร/ขาดทุน (Live breakdown) */}
                {previewData && (
                  <div className="group rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950/60 p-5 shadow-sm hover:shadow-md hover:shadow-teal-500/5 hover:border-teal-200 dark:hover:border-teal-900/60 transition-all duration-300">
                    <div className="flex items-center gap-3.5 mb-5">
                      <div className="flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-teal-50 to-emerald-100/80 dark:from-teal-950/60 dark:to-emerald-900/40 text-teal-600 dark:text-teal-400 ring-1 ring-teal-100 dark:ring-teal-900/60 group-hover:scale-105 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">คำนวณยอดปิดสัญญา + กำไร/ขาดทุน</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">มุมมองไฟแนนซ์ ไม่รวม VAT</p>
                      </div>
                    </div>

                    {/* Inputs */}
                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">ราคากลาง (บาท)</label>
                        <input
                          type="number"
                          value={createForm.marketValue}
                          onChange={(e) => setCreateForm({ ...createForm, marketValue: e.target.value })}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-teal-300 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                          placeholder={String(previewData.calculation.marketValue || 0)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">ส่วนลดลูกค้า (%)</label>
                        <input
                          type="number"
                          value={createForm.discountPct}
                          onChange={(e) => setCreateForm({ ...createForm, discountPct: e.target.value })}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-teal-300 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                          placeholder="50"
                        />
                      </div>
                    </div>

                    {/* Customer refund toggle */}
                    <label className="flex items-center gap-2 cursor-pointer mb-5 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
                      <input
                        type="checkbox"
                        checked={createForm.customerRefundEnabled}
                        onChange={(e) => setCreateForm({ ...createForm, customerRefundEnabled: e.target.checked })}
                        className="rounded border-slate-300 text-teal-600 focus:ring-2 focus:ring-teal-500/20"
                      />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">คืนเงินส่วนต่างให้ลูกค้า</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">(กรณีราคากลาง &gt; ยอดปิด)</span>
                    </label>

                    {/* Live breakdown */}
                    <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/60 dark:from-slate-900 dark:to-slate-900/60 p-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">ยอดค้าง (รวม VAT)</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{previewData.calculation.outstandingBalance.toLocaleString()} ฿</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">ค่างวดไม่รวม VAT (÷ 1.07)</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{previewData.calculation.principalExVat.toLocaleString()} ฿</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">ต้นทุนคงเหลือ (financedAmount + คอม)</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{previewData.calculation.remainingCost.toLocaleString()} ฿</span>
                      </div>
                      <div className="flex justify-between text-xs border-t border-slate-200 dark:border-slate-700 pt-2">
                        <span className="text-slate-600 dark:text-slate-400">ส่วนลดลูกค้า ({previewData.calculation.discountPct}%)</span>
                        <span className="font-medium text-rose-600 dark:text-rose-400">- {previewData.calculation.discountAmount.toLocaleString()} ฿</span>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">ยอดปิดสัญญา</span>
                        <span className="font-bold text-slate-900 dark:text-slate-50">{previewData.calculation.closingAmount.toLocaleString()} ฿</span>
                      </div>

                      {/* Market value & refund */}
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-600 dark:text-slate-400">ราคากลางเครื่อง</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{previewData.calculation.marketValue.toLocaleString()} ฿</span>
                        </div>
                        {previewData.calculation.customerRefundEnabled && (
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">เงินคืนลูกค้า</span>
                            <span className="font-medium text-rose-600 dark:text-rose-400">- {previewData.calculation.customerRefund.toLocaleString()} ฿</span>
                          </div>
                        )}
                      </div>

                      {/* Final P&L */}
                      <div className={`flex justify-between items-center mt-2 p-3 rounded-lg ${previewData.calculation.profitLoss >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-900/60' : 'bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-900/60'}`}>
                        <div>
                          <div className={`text-xs font-medium ${previewData.calculation.profitLoss >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                            {previewData.calculation.profitLoss >= 0 ? '✓ บริษัทได้กำไร' : '✗ บริษัทขาดทุน'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">ราคากลาง - ต้นทุนคงเหลือ - เงินคืน</div>
                        </div>
                        <div className={`text-xl font-bold ${previewData.calculation.profitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {previewData.calculation.profitLoss >= 0 ? '+' : ''}{previewData.calculation.profitLoss.toLocaleString()} ฿
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 5: หมายเหตุ */}
                <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950/60 p-5 shadow-sm">
                  <div className="flex items-center gap-3.5 mb-4">
                    <div className="flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/80 dark:from-slate-900 dark:to-slate-800/40 text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">หมายเหตุ</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">บันทึกเพิ่มเติม (ถ้ามี)</p>
                    </div>
                  </div>
                  <textarea
                    value={createForm.notes}
                    onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm transition-colors hover:border-slate-300 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/20 resize-none"
                    placeholder="หมายเหตุ..."
                  />
                </div>
              </div>

              {/* Sticky Footer */}
              <div className="sticky bottom-0 bg-gradient-to-t from-white to-slate-50/80 dark:from-slate-950 dark:to-slate-900/80 backdrop-blur-xl border-t border-slate-200/60 dark:border-slate-800/60 px-6 py-4 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-5 py-2.5 text-sm border border-slate-200 dark:border-slate-700/80 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600 transition-all font-medium text-slate-700 dark:text-slate-300">
                  ยกเลิก
                </button>
                <button type="submit" disabled={createMutation.isPending} className="px-6 py-2.5 text-sm bg-gradient-to-b from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all shadow-sm shadow-sky-600/20 hover:shadow-md hover:shadow-sky-600/30 ring-1 ring-sky-600/20">
                  {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการยึดคืน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Modal */}
      <Modal isOpen={isUpdateModalOpen} onClose={() => setIsUpdateModalOpen(false)} title="จัดการเครื่องยึดคืน">
        {selectedRepo && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="bg-muted rounded-lg p-3 text-sm">
              <div><strong>สินค้า:</strong> {selectedRepo.product.brand} {selectedRepo.product.model}</div>
              <div><strong>สัญญา:</strong> {selectedRepo.contract.contractNumber}</div>
              <div><strong>ลูกค้า:</strong> {selectedRepo.contract.customer.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">สถานะ</label>
              <select
                value={updateForm.status}
                onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              >
                {/* Show only valid status transitions based on current status */}
                {selectedRepo.status === 'REPOSSESSED' && <>
                  <option value="REPOSSESSED">ยึดคืนแล้ว</option>
                  <option value="UNDER_REPAIR">กำลังซ่อม</option>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                </>}
                {selectedRepo.status === 'UNDER_REPAIR' && <>
                  <option value="UNDER_REPAIR">กำลังซ่อม</option>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                </>}
                {selectedRepo.status === 'READY_FOR_SALE' && <>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                  <option value="SOLD">ขายแล้ว</option>
                </>}
                {selectedRepo.status === 'SOLD' && <>
                  <option value="SOLD">ขายแล้ว</option>
                </>}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ค่าซ่อม (บาท)</label>
                <input
                  type="number"
                  value={updateForm.repairCost}
                  onChange={(e) => setUpdateForm({ ...updateForm, repairCost: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ราคาขายต่อ (บาท)</label>
                <input
                  type="number"
                  value={updateForm.resellPrice}
                  onChange={(e) => setUpdateForm({ ...updateForm, resellPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea
                value={updateForm.notes}
                onChange={(e) => setUpdateForm({ ...updateForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsUpdateModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}
