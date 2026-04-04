import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import { useDebounce } from '@/hooks/useDebounce';
import { exportToExcel } from '@/utils/excel.util';
import { toast } from 'sonner';

interface PaymentEvidence {
  id: string;
  contractId: string;
  lineUserId: string | null;
  imageUrl: string;
  amount: number | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  contract: {
    contractNumber: string;
    customer: { name: string; phone: string };
  };
  reviewedBy: { name: string } | null;
}

const statusLabels: Record<string, string> = {
  PENDING_REVIEW: 'รอตรวจ',
  APPROVED: 'อนุมัติ',
  REJECTED: 'ปฏิเสธ',
};

export default function SlipReviewPage() {
  const queryClient = useQueryClient();

  // Filter state
  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);

  // Review modal state
  const [selectedEvidence, setSelectedEvidence] = useState<PaymentEvidence | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [approveMethod, setApproveMethod] = useState('BANK_TRANSFER');

  // Zoom/rotate state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);
  const [batchRejectNote, setBatchRejectNote] = useState('');

  // Reset zoom/rotate when changing evidence
  useEffect(() => {
    setZoomLevel(1);
    setRotation(0);
  }, [selectedEvidence]);

  // Clear selection when changing filters
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, debouncedSearch, dateFrom, dateTo]);

  // ─── Stats Query ───
  const { data: stats } = useQuery({
    queryKey: ['payment-evidences-stats'],
    queryFn: async () => {
      const res = await api.get('/line-oa/evidence/stats');
      return res.data;
    },
  });

  // ─── Evidence List Query ───
  const { data: evidences = [], isLoading } = useQuery({
    queryKey: ['payment-evidences', statusFilter, debouncedSearch, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await api.get(`/line-oa/evidence?${params}`);
      return res.data as PaymentEvidence[];
    },
  });

  // ─── Mutations ───
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-evidences'] });
    queryClient.invalidateQueries({ queryKey: ['payment-evidences-stats'] });
  };

  const approveMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      return api.post(`/line-oa/evidence/${evidenceId}/approve`, {
        amount: Number(approveAmount),
        paymentMethod: approveMethod,
        installmentNo: 1,
        reviewNote,
      });
    },
    onSuccess: () => {
      toast.success('อนุมัติสลิปเรียบร้อย');
      invalidateAll();
      setSelectedEvidence(null);
      setReviewNote('');
      setApproveAmount('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      return api.post(`/line-oa/evidence/${evidenceId}/reject`, { reviewNote });
    },
    onSuccess: () => {
      toast.success('ปฏิเสธสลิปเรียบร้อย');
      invalidateAll();
      setSelectedEvidence(null);
      setReviewNote('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const batchApproveMutation = useMutation({
    mutationFn: async () => {
      return api.post('/line-oa/evidence/batch-approve', {
        ids: Array.from(selectedIds),
        paymentMethod: 'BANK_TRANSFER',
      });
    },
    onSuccess: (res) => {
      toast.success(`อนุมัติสำเร็จ ${res.data.count} รายการ`);
      setSelectedIds(new Set());
      invalidateAll();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const batchRejectMutation = useMutation({
    mutationFn: async () => {
      return api.post('/line-oa/evidence/batch-reject', {
        ids: Array.from(selectedIds),
        reviewNote: batchRejectNote || undefined,
      });
    },
    onSuccess: (res) => {
      toast.success(`ปฏิเสธสำเร็จ ${res.data.count} รายการ`);
      setSelectedIds(new Set());
      setShowBatchRejectModal(false);
      setBatchRejectNote('');
      invalidateAll();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ─── Batch Selection Helpers ───
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === evidences.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(evidences.map((ev) => ev.id)));
    }
  };

  // ─── Export Excel ───
  const exportExcel = async () => {
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('limit', '10000');
      const { data } = await api.get(`/line-oa/evidence?${params}`);

      const now = new Date();
      await exportToExcel({
        columns: [
          { header: 'เลขสัญญา', key: 'contractNumber', width: 18 },
          { header: 'ชื่อลูกค้า', key: 'customerName', width: 25 },
          { header: 'จำนวนเงิน', key: 'amount', width: 14 },
          { header: 'สถานะ', key: 'status', width: 12 },
          { header: 'ผู้ตรวจ', key: 'reviewer', width: 20 },
          { header: 'วันที่ส่ง', key: 'createdAt', width: 18 },
          { header: 'วันที่ตรวจ', key: 'reviewedAt', width: 18 },
          { header: 'หมายเหตุ', key: 'note', width: 30 },
        ],
        data: data.map((ev: PaymentEvidence) => ({
          contractNumber: ev.contract.contractNumber,
          customerName: ev.contract.customer.name,
          amount: ev.amount ? Number(ev.amount) : '-',
          status: statusLabels[ev.status] || ev.status,
          reviewer: ev.reviewedBy?.name || '-',
          createdAt: new Date(ev.createdAt).toLocaleString('th-TH'),
          reviewedAt: ev.reviewedAt ? new Date(ev.reviewedAt).toLocaleString('th-TH') : '-',
          note: ev.reviewNote || '-',
        })),
        sheetName: 'สลิปชำระเงิน',
        filename: `สลิปชำระเงิน_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${data.length} รายการ)`, { id: 'excel-export' });
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้', { id: 'excel-export' });
    }
  };

  // ─── Status Badge ───
  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      PENDING_REVIEW: 'bg-warning/10 text-warning dark:bg-warning/15',
      APPROVED: 'bg-success/10 text-success dark:bg-success/15',
      REJECTED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-muted'}`}>
        {statusLabels[status] || status}
      </span>
    );
  };

  return (
    <div className="p-6">
      <PageHeader
        title="ตรวจสอบสลิปชำระเงิน"
        subtitle="สลิปที่ลูกค้าส่งผ่าน LINE OA"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รอตรวจ</div>
            <div className="text-2xl font-bold text-warning">{stats?.pendingCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อนุมัติวันนี้</div>
            <div className="text-2xl font-bold text-success">{stats?.approvedToday ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ปฏิเสธวันนี้</div>
            <div className="text-2xl font-bold text-destructive">{stats?.rejectedToday ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวมอนุมัติวันนี้</div>
            <div className="text-2xl font-bold text-success">
              {Number(stats?.approvedAmountToday || 0).toLocaleString()} ฿
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Filter + Export */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['PENDING_REVIEW', 'APPROVED', 'REJECTED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {{ PENDING_REVIEW: 'รอตรวจ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธแล้ว' }[status]}
            </button>
          ))}
        </div>
        <button
          onClick={exportExcel}
          className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted"
        >
          ส่งออก Excel
        </button>
      </div>

      {/* Search/Filter Bar */}
      <div className="bg-card rounded-lg border border-border/60 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาชื่อลูกค้า / เลขสัญญา..."
            className="px-3 py-2 border border-input rounded-lg text-sm md:col-span-2"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Select All (only for PENDING_REVIEW) */}
      {statusFilter === 'PENDING_REVIEW' && evidences.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={selectedIds.size === evidences.length && evidences.length > 0}
            onChange={toggleSelectAll}
            className="w-4 h-4"
          />
          <span className="text-sm text-muted-foreground">
            เลือกทั้งหมด ({evidences.length})
          </span>
        </div>
      )}

      {/* Evidence List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
      ) : evidences.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">ไม่มีสลิปที่ต้องตรวจสอบ</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {evidences.map((ev) => (
            <div
              key={ev.id}
              className="relative bg-card rounded-xl shadow-card border p-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                setSelectedEvidence(ev);
                setApproveAmount(ev.amount?.toString() || '');
              }}
            >
              {/* Batch checkbox */}
              {statusFilter === 'PENDING_REVIEW' && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(ev.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSelection(ev.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-3 right-3 w-5 h-5 z-10"
                />
              )}

              <div className="flex justify-between items-start mb-3 pr-6">
                <div>
                  <p className="font-medium">{ev.contract.customer.name}</p>
                  <p className="text-sm text-muted-foreground">{ev.contract.contractNumber}</p>
                </div>
                {statusBadge(ev.status)}
              </div>

              <img
                src={ev.imageUrl}
                alt="สลิป"
                className="w-full h-40 object-cover rounded-lg bg-muted mb-3"
              />

              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{new Date(ev.createdAt).toLocaleString('th-TH')}</span>
                {ev.amount && (
                  <span className="font-medium text-success">
                    {Number(ev.amount).toLocaleString()} บาท
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex items-center justify-between z-50 shadow-lg">
          <span className="text-sm font-medium">{selectedIds.size} รายการที่เลือก</span>
          <div className="flex gap-3">
            <button
              onClick={() => batchApproveMutation.mutate()}
              disabled={batchApproveMutation.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-muted"
            >
              {batchApproveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติทั้งหมด'}
            </button>
            <button
              onClick={() => setShowBatchRejectModal(true)}
              disabled={batchRejectMutation.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:bg-muted"
            >
              ปฏิเสธทั้งหมด
            </button>
          </div>
        </div>
      )}

      {/* Batch Reject Note Modal */}
      {showBatchRejectModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            setShowBatchRejectModal(false);
            setBatchRejectNote('');
          }}
          title="ปฏิเสธสลิปที่เลือก"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              จะปฏิเสธ {selectedIds.size} รายการ
            </p>
            <textarea
              value={batchRejectNote}
              onChange={(e) => setBatchRejectNote(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              placeholder="เหตุผลในการปฏิเสธ (ถ้ามี)"
            />
            <div className="flex gap-3">
              <button
                onClick={() => batchRejectMutation.mutate()}
                disabled={batchRejectMutation.isPending}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 disabled:bg-muted"
              >
                {batchRejectMutation.isPending ? 'กำลังปฏิเสธ...' : 'ยืนยันปฏิเสธ'}
              </button>
              <button
                onClick={() => {
                  setShowBatchRejectModal(false);
                  setBatchRejectNote('');
                }}
                className="flex-1 bg-muted py-2 px-4 rounded-lg font-medium"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Review Modal */}
      {selectedEvidence && (
        <Modal
          isOpen={true}
          onClose={() => {
            setSelectedEvidence(null);
            setReviewNote('');
          }}
          title={`ตรวจสอบสลิป - ${selectedEvidence.contract.customer.name}`}
          size="lg"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Slip Image with Zoom/Rotate */}
            <div className="space-y-2">
              <div className="flex justify-center gap-2 p-2 border rounded-lg bg-muted/50">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="px-2 py-1 text-sm border rounded hover:bg-muted"
                >
                  -
                </button>
                <button
                  onClick={() => { setZoomLevel(1); setRotation(0); }}
                  className="px-2 py-1 text-sm border rounded hover:bg-muted"
                >
                  รีเซ็ต
                </button>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="px-2 py-1 text-sm border rounded hover:bg-muted"
                >
                  +
                </button>
                <button
                  onClick={() => setRotation((r) => r + 90)}
                  className="px-2 py-1 text-sm border rounded hover:bg-muted"
                >
                  หมุน 90°
                </button>
              </div>
              <div
                className="overflow-hidden rounded-lg border bg-muted flex items-center justify-center min-h-[300px]"
                onWheel={(e) => {
                  e.preventDefault();
                  setZoomLevel((z) => Math.min(3, Math.max(0.5, z + (e.deltaY > 0 ? -0.1 : 0.1))));
                }}
              >
                <img
                  src={selectedEvidence.imageUrl}
                  alt="สลิปชำระเงิน"
                  className="max-w-full transition-transform duration-200"
                  style={{ transform: `scale(${zoomLevel}) rotate(${rotation}deg)` }}
                />
              </div>
            </div>

            {/* Details & Actions */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">ข้อมูลสัญญา</h3>
                <p className="font-medium">{selectedEvidence.contract.contractNumber}</p>
                <p className="text-sm text-muted-foreground">{selectedEvidence.contract.customer.name}</p>
                <p className="text-sm text-muted-foreground">{selectedEvidence.contract.customer.phone}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-muted-foreground">เวลาส่ง</h3>
                <p>{new Date(selectedEvidence.createdAt).toLocaleString('th-TH')}</p>
              </div>

              {selectedEvidence.status === 'PENDING_REVIEW' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      จำนวนเงิน (บาท)
                    </label>
                    <input
                      type="number"
                      value={approveAmount}
                      onChange={(e) => setApproveAmount(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="จำนวนเงินในสลิป"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      ช่องทาง
                    </label>
                    <select
                      value={approveMethod}
                      onChange={(e) => setApproveMethod(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="BANK_TRANSFER">โอนเงิน</option>
                      <option value="QR_EWALLET">QR/E-Wallet</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      หมายเหตุ
                    </label>
                    <textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2"
                      rows={2}
                      placeholder="หมายเหตุ (ถ้ามี)"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => approveMutation.mutate(selectedEvidence.id)}
                      disabled={!approveAmount || approveMutation.isPending}
                      className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-700 disabled:bg-muted disabled:cursor-not-allowed"
                    >
                      {approveMutation.isPending ? 'กำลังบันทึก...' : 'อนุมัติ'}
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate(selectedEvidence.id)}
                      disabled={rejectMutation.isPending}
                      className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 disabled:bg-muted"
                    >
                      {rejectMutation.isPending ? 'กำลังบันทึก...' : 'ปฏิเสธ'}
                    </button>
                  </div>
                </>
              )}

              {selectedEvidence.status !== 'PENDING_REVIEW' && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    ตรวจสอบโดย: {selectedEvidence.reviewedBy?.name || '-'}
                  </p>
                  {selectedEvidence.reviewNote && (
                    <p className="text-sm text-muted-foreground mt-1">
                      หมายเหตุ: {selectedEvidence.reviewNote}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
