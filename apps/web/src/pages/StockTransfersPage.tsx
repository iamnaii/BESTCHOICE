import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { transferStatusLabels } from '@/lib/constants';

interface TransferProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  color: string | null;
  storage: string | null;
  photos: string[];
  status: string;
}

interface StockTransfer {
  id: string;
  batchNumber: string | null;
  productId: string;
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  status: string;
  notes: string | null;
  trackingNote: string | null;
  confirmedBy: { id: string; name: string } | null;
  confirmedAt: string | null;
  dispatchedBy: { id: string; name: string } | null;
  dispatchedAt: string | null;
  expectedDeliveryDate: string | null;
  createdAt: string;
  product: TransferProduct;
}

type TabKey = 'outgoing' | 'incoming' | 'history';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'outgoing', label: 'โอนออก' },
  { key: 'incoming', label: 'รอรับเข้า' },
  { key: 'history', label: 'ประวัติ' },
];

export default function StockTransfersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('view') as TabKey) || 'outgoing';
  const [statusFilter, setStatusFilter] = useState('PENDING');

  // --- Branch receiving state ---
  const [selectedBranch, setSelectedBranch] = useState('');
  const [isBatchReceiveModalOpen, setIsBatchReceiveModalOpen] = useState(false);
  const [receivingBatch, setReceivingBatch] = useState<StockTransfer[]>([]);
  const [itemStatuses, setItemStatuses] = useState<Record<string, { status: 'PASS' | 'REJECT'; imei: string; conditionNotes: string; rejectReason: string }>>({});
  const [batchReceiveNotes, setBatchReceiveNotes] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // --- Transfer slip modal state (outgoing only) ---
  const [isSlipModalOpen, setIsSlipModalOpen] = useState(false);
  const [slipBatchItems, setSlipBatchItems] = useState<StockTransfer[]>([]);

  const goToTab = (key: TabKey) => setSearchParams({ view: key });

  // ============ OUTGOING TAB QUERIES ============
  const { data: transfers = [], isLoading: loadingTransfers } = useQuery<StockTransfer[]>({
    queryKey: ['stock-transfers', statusFilter],
    queryFn: async () => {
      if (statusFilter === 'PENDING') {
        return (await api.get('/products/transfers/pending')).data;
      }
      if (statusFilter === 'IN_TRANSIT') {
        return (await api.get('/products/transfers/in-transit')).data;
      }
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get(`/products/transfers/history${params}`);
      return res.data?.data || res.data;
    },
    enabled: activeTab === 'outgoing',
  });

  const dispatchMutation = useMutation({
    mutationFn: async ({ transferId, trackingNote }: { transferId: string; trackingNote?: string }) =>
      api.post(`/products/transfers/${transferId}/dispatch`, { trackingNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('จัดส่งสินค้าเรียบร้อย');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ transferId, reason }: { transferId: string; reason?: string }) =>
      api.post(`/products/transfers/${transferId}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('ปฏิเสธการโอนสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // ============ INCOMING TAB QUERIES ============
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    enabled: activeTab === 'incoming' || activeTab === 'history',
  });

  const { data: pendingDeliveries, isLoading: loadingPending } = useQuery({
    queryKey: ['branch-receiving-pending', selectedBranch],
    queryFn: () => api.get('/branch-receiving/pending-deliveries', { params: { branchId: selectedBranch } }).then((r) => r.data),
    enabled: activeTab === 'incoming' && !!selectedBranch,
  });

  // No single receiveMutation needed — batch submit handles it

  // ============ HISTORY TAB QUERIES ============
  const { data: receivingHistory } = useQuery({
    queryKey: ['branch-receiving-history', selectedBranch],
    queryFn: () => api.get('/branch-receiving', { params: { branchId: selectedBranch || undefined } }).then((r) => r.data),
    enabled: activeTab === 'history',
  });

  // ============ HELPERS ============
  const openSlipModal = (items: StockTransfer[]) => {
    setSlipBatchItems(items);
    setIsSlipModalOpen(true);
  };

  const openBatchReceiveModal = (items: StockTransfer[]) => {
    setIsSlipModalOpen(false);
    setReceivingBatch(items);
    const initial: typeof itemStatuses = {};
    for (const t of items) {
      initial[t.id] = { status: 'PASS', imei: '', conditionNotes: '', rejectReason: '' };
    }
    setItemStatuses(initial);
    setBatchReceiveNotes('');
    setIsBatchReceiveModalOpen(true);
  };

  const updateItemStatus = (transferId: string, field: string, value: string) => {
    setItemStatuses((prev) => ({
      ...prev,
      [transferId]: { ...prev[transferId], [field]: value },
    }));
  };

  const handleBatchReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate: rejected items must have reason
    for (const t of receivingBatch) {
      const s = itemStatuses[t.id];
      if (s.status === 'REJECT' && !s.rejectReason) {
        toast.error(`กรุณาระบุเหตุผลที่ไม่ผ่านสำหรับ ${t.product.brand} ${t.product.model}`);
        return;
      }
    }
    setBatchSubmitting(true);
    let passCount = 0;
    let rejectCount = 0;
    let errorCount = 0;
    for (const t of receivingBatch) {
      const s = itemStatuses[t.id];
      try {
        await api.post('/branch-receiving', {
          transferId: t.id,
          items: [{
            productId: t.product.id,
            imeiSerial: s.imei || undefined,
            status: s.status,
            conditionNotes: s.conditionNotes || undefined,
            rejectReason: s.status === 'REJECT' ? s.rejectReason : undefined,
          }],
          notes: batchReceiveNotes || undefined,
        });
        if (s.status === 'PASS') passCount++;
        else rejectCount++;
      } catch (err) {
        errorCount++;
        toast.error(`${t.product.brand} ${t.product.model}: ${getErrorMessage(err)}`);
      }
    }
    setBatchSubmitting(false);
    queryClient.invalidateQueries({ queryKey: ['branch-receiving'] });
    queryClient.invalidateQueries({ queryKey: ['branch-receiving-pending'] });
    queryClient.invalidateQueries({ queryKey: ['branch-receiving-history'] });
    queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
    if (errorCount === 0) {
      if (rejectCount === 0) {
        toast.success(`รับสินค้าทั้งหมด ${passCount} รายการสำเร็จ`);
      } else {
        toast.success(`รับ ${passCount} ปฏิเสธ ${rejectCount} รายการ`);
      }
      setIsBatchReceiveModalOpen(false);
    }
  };

  const pendingList: StockTransfer[] = pendingDeliveries || [];
  const historyList = receivingHistory?.data || [];

  // ============ INCOMING: GROUP BY BATCH ============
  const [expandedIncoming, setExpandedIncoming] = useState<Set<string>>(new Set());

  const toggleIncoming = (batchKey: string) => {
    setExpandedIncoming((prev) => {
      const next = new Set(prev);
      if (next.has(batchKey)) next.delete(batchKey);
      else next.add(batchKey);
      return next;
    });
  };

  const incomingBatchGroups = useMemo(() => {
    const map = new Map<string, StockTransfer[]>();
    for (const t of pendingList) {
      const key = t.batchNumber || `_single_${t.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([batchKey, items]) => ({
      batchKey,
      batchNumber: items[0].batchNumber,
      items,
      fromBranch: items[0].fromBranch,
      toBranch: items[0].toBranch,
      dispatchedAt: items[0].dispatchedAt,
      trackingNote: items[0].trackingNote,
    }));
  }, [pendingList]);

  // ============ OUTGOING: GROUP BY BATCH ============
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const toggleBatch = (batchKey: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchKey)) next.delete(batchKey);
      else next.add(batchKey);
      return next;
    });
  };

  interface BatchGroup {
    batchKey: string;
    batchNumber: string | null;
    items: StockTransfer[];
    fromBranch: { id: string; name: string };
    toBranch: { id: string; name: string };
    status: string;
    createdAt: string;
    dispatchedAt: string | null;
    dispatchedBy: { id: string; name: string } | null;
    confirmedBy: { id: string; name: string } | null;
    confirmedAt: string | null;
    notes: string | null;
    trackingNote: string | null;
  }

  const batchGroups: BatchGroup[] = useMemo(() => {
    const map = new Map<string, StockTransfer[]>();
    for (const t of transfers) {
      const key = t.batchNumber || `_single_${t.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([batchKey, items]) => {
      const first = items[0];
      return {
        batchKey,
        batchNumber: first.batchNumber,
        items,
        fromBranch: first.fromBranch,
        toBranch: first.toBranch,
        status: first.status,
        createdAt: first.createdAt,
        dispatchedAt: first.dispatchedAt,
        dispatchedBy: first.dispatchedBy,
        confirmedBy: first.confirmedBy,
        confirmedAt: first.confirmedAt,
        notes: first.notes,
        trackingNote: first.trackingNote,
      };
    });
  }, [transfers]);

  return (
    <div>
      <PageHeader
        title="จัดการโอนสินค้าระหว่างสาขา"
        subtitle="โอนออก ตรวจรับเข้า และดูประวัติทั้งหมด"
      />

      {/* Tab Bar */}
      <div className="mb-4 border-b border-gray-200">
        <nav className="-mb-px flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => goToTab(tab.key)}
              className={clsx(
                'whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer',
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              {tab.label}
              {tab.key === 'incoming' && pendingList.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
                  {pendingList.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ============ TAB: โอนออก ============ */}
      {activeTab === 'outgoing' && (
        <div>
          <div className="mb-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="PENDING">รอจัดส่ง</option>
              <option value="IN_TRANSIT">ระหว่างโอนสินค้า</option>
              <option value="CONFIRMED">รับแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
              <option value="">ทั้งหมด</option>
            </select>
          </div>

          {loadingTransfers ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
              กำลังโหลด...
            </div>
          ) : batchGroups.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              {statusFilter === 'PENDING' ? 'ไม่มีรายการรอจัดส่ง'
                : statusFilter === 'IN_TRANSIT' ? 'ไม่มีรายการระหว่างโอนสินค้า'
                : 'ไม่พบรายการโอน'}
            </div>
          ) : (
            <div className="space-y-2">
              {batchGroups.map((batch) => {
                const isExpanded = expandedBatches.has(batch.batchKey);
                const s = transferStatusLabels[batch.status] || { label: batch.status, className: 'bg-gray-100 text-gray-700' };
                return (
                  <div key={batch.batchKey} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {/* Batch Header */}
                    <button
                      onClick={() => toggleBatch(batch.batchKey)}
                      className="w-full px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-primary-600">
                          {batch.batchNumber || '-'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
                          {s.label}
                        </span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {batch.items.length} รายการ
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                        <span>{batch.fromBranch.name} → {batch.toBranch.name}</span>
                        <span>{new Date(batch.createdAt).toLocaleDateString('th-TH')}</span>
                      </div>
                      <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {batch.status === 'PENDING' && (
                          <button
                            onClick={() => {
                              const note = prompt('หมายเหตุการจัดส่ง (ถ้ามี):');
                              if (note !== null) {
                                batch.items.forEach((item) => {
                                  dispatchMutation.mutate({ transferId: item.id, trackingNote: note || undefined });
                                });
                              }
                            }}
                            disabled={dispatchMutation.isPending}
                            className="px-3 py-1 bg-primary-600 text-white rounded text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
                          >
                            จัดส่งทั้งใบ
                          </button>
                        )}
                        {batch.status === 'IN_TRANSIT' && (
                          <button
                            onClick={() => openSlipModal(batch.items)}
                            className="px-3 py-1 bg-primary-600 text-white rounded text-xs font-medium hover:bg-primary-700"
                          >
                            ใบโอนสินค้า
                          </button>
                        )}
                      </div>
                    </button>

                    {/* Expanded Product List */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">สินค้า</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">IMEI / S/N</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">สี / ความจุ</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">สถานะ</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">หมายเหตุ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {batch.items.map((t, idx) => {
                              const itemStatus = transferStatusLabels[t.status] || { label: t.status, className: 'bg-gray-100 text-gray-700' };
                              return (
                                <tr key={t.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-xs text-gray-400">{idx + 1}</td>
                                  <td className="px-4 py-2">
                                    <button
                                      onClick={() => navigate(`/products/${t.product.id}`)}
                                      className="text-left hover:underline"
                                    >
                                      <span className="text-primary-600 font-medium">
                                        {t.product.brand} {t.product.model}
                                      </span>
                                    </button>
                                  </td>
                                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                                    {t.product.imeiSerial || t.product.serialNumber || '-'}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-500">
                                    {[t.product.color, t.product.storage].filter(Boolean).join(' / ') || '-'}
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${itemStatus.className}`}>
                                      {itemStatus.label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-500">
                                    {t.trackingNote || t.notes || '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {/* Batch footer info */}
                        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 flex gap-4 flex-wrap">
                          {batch.dispatchedBy && <span>จัดส่งโดย: {batch.dispatchedBy.name}</span>}
                          {batch.dispatchedAt && <span>วันจัดส่ง: {new Date(batch.dispatchedAt).toLocaleString('th-TH')}</span>}
                          {batch.confirmedBy && <span>ยืนยันโดย: {batch.confirmedBy.name}</span>}
                          {batch.confirmedAt && <span>วันยืนยัน: {new Date(batch.confirmedAt).toLocaleString('th-TH')}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============ TAB: รอรับเข้า ============ */}
      {activeTab === 'incoming' && (
        <div>
          <div className="mb-4">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">เลือกสาขา</option>
              {(branches || []).map((b: { id: string; name: string }) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {!selectedBranch ? (
            <div className="text-center py-10 text-gray-500">กรุณาเลือกสาขาเพื่อดูรายการรอรับ</div>
          ) : loadingPending ? (
            <div className="text-center py-4 text-gray-500">กำลังโหลด...</div>
          ) : incomingBatchGroups.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">ไม่มีสินค้ารอรับเข้าสาขานี้</div>
          ) : (
            <div className="space-y-2">
              {incomingBatchGroups.map((batch) => {
                const isExpanded = expandedIncoming.has(batch.batchKey);
                return (
                  <div key={batch.batchKey} className="bg-white rounded-lg border border-yellow-200 overflow-hidden">
                    {/* Batch Header */}
                    <button
                      onClick={() => toggleIncoming(batch.batchKey)}
                      className="w-full px-4 py-3 flex items-center gap-4 hover:bg-yellow-50 transition-colors text-left"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-primary-600">
                          {batch.batchNumber || '-'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                          รอตรวจรับ
                        </span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {batch.items.length} รายการ
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                        <span>จาก: {batch.fromBranch.name}</span>
                        {batch.dispatchedAt && <span>ส่ง: {new Date(batch.dispatchedAt).toLocaleDateString('th-TH')}</span>}
                      </div>
                      <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openBatchReceiveModal(batch.items)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                        >
                          ตรวจรับทั้งใบ
                        </button>
                      </div>
                    </button>

                    {/* Expanded Product List */}
                    {isExpanded && (
                      <div className="border-t border-yellow-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-yellow-50">
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">สินค้า</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">IMEI / S/N</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">สี / ความจุ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-yellow-50">
                            {batch.items.map((t, idx) => (
                              <tr key={t.id} className="hover:bg-yellow-50">
                                <td className="px-4 py-2 text-xs text-gray-400">{idx + 1}</td>
                                <td className="px-4 py-2">
                                  <span className="font-medium text-gray-800">
                                    {t.product.brand} {t.product.model}
                                  </span>
                                </td>
                                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                                  {t.product.imeiSerial || t.product.serialNumber || '-'}
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-500">
                                  {[t.product.color, t.product.storage].filter(Boolean).join(' / ') || '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {batch.trackingNote && (
                          <div className="px-4 py-2 bg-yellow-50 text-xs text-primary-600">
                            หมายเหตุจัดส่ง: {batch.trackingNote}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============ TAB: ประวัติ ============ */}
      {activeTab === 'history' && (
        <div>
          <div className="mb-4">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">ทุกสาขา</option>
              {(branches || []).map((b: { id: string; name: string }) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {historyList.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">ยังไม่มีประวัติการรับ</div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">สินค้า</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">จาก</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">ผู้รับ</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">สถานะ</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">วันที่</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historyList.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.transfer?.product?.name || '-'}</div>
                        <div className="text-xs text-gray-400 font-mono">{r.transfer?.product?.imeiSerial || ''}</div>
                      </td>
                      <td className="px-4 py-3">{r.transfer?.fromBranch?.name || '-'}</td>
                      <td className="px-4 py-3">{r.receivedBy?.name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          r.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {r.status === 'COMPLETED' ? 'ผ่าน' : 'ไม่ผ่าน'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(r.createdAt).toLocaleDateString('th-TH')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ TRANSFER SLIP MODAL (outgoing) ============ */}
      <Modal isOpen={isSlipModalOpen} onClose={() => setIsSlipModalOpen(false)} title="ใบโอนสินค้า" size="lg">
        {slipBatchItems.length > 0 && (() => {
          const first = slipBatchItems[0];
          return (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-dashed border-gray-300 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">ใบโอนสินค้า</h3>
                  <p className="text-sm text-gray-500 font-mono mt-0.5">{first.batchNumber || '-'}</p>
                </div>
                <span className="px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm font-medium">
                  {slipBatchItems.length} รายการ
                </span>
              </div>

              {/* Branch Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-orange-50 rounded-lg p-3">
                  <div className="text-xs text-orange-600 font-medium mb-1">ต้นทาง</div>
                  <div className="font-semibold text-gray-800">{first.fromBranch.name}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-xs text-green-600 font-medium mb-1">ปลายทาง</div>
                  <div className="font-semibold text-gray-800">{first.toBranch.name}</div>
                </div>
              </div>

              {/* Product List */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500 font-medium mb-3">รายการสินค้า ({slipBatchItems.length})</div>
                <div className="space-y-3">
                  {slipBatchItems.map((t, idx) => (
                    <div key={t.id} className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 mt-1 w-5">{idx + 1}.</span>
                      {t.product.photos?.[0] && (
                        <img src={t.product.photos[0]} alt="" className="w-12 h-12 object-cover rounded-lg border" />
                      )}
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 text-sm">{t.product.brand} {t.product.model}</div>
                        <div className="text-xs text-gray-500 space-y-0.5">
                          {t.product.color && <span>สี: {t.product.color} </span>}
                          {t.product.storage && <span>ความจุ: {t.product.storage}</span>}
                          {t.product.imeiSerial && <div className="font-mono">IMEI: {t.product.imeiSerial}</div>}
                          {t.product.serialNumber && <div className="font-mono">S/N: {t.product.serialNumber}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transfer Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">วันที่สร้างใบโอน:</span>
                  <span className="ml-2 font-medium">{new Date(first.createdAt).toLocaleDateString('th-TH')}</span>
                </div>
                {first.dispatchedAt && (
                  <div>
                    <span className="text-gray-500">วันที่จัดส่ง:</span>
                    <span className="ml-2 font-medium">{new Date(first.dispatchedAt).toLocaleDateString('th-TH')}</span>
                  </div>
                )}
                {first.dispatchedBy && (
                  <div>
                    <span className="text-gray-500">จัดส่งโดย:</span>
                    <span className="ml-2 font-medium">{first.dispatchedBy.name}</span>
                  </div>
                )}
              </div>

              {/* Notes */}
              {(first.notes || first.trackingNote) && (
                <div className="bg-primary-50 rounded-lg p-3">
                  {first.notes && <div className="text-sm text-gray-700">หมายเหตุ: {first.notes}</div>}
                  {first.trackingNote && <div className="text-sm text-primary-700">หมายเหตุจัดส่ง: {first.trackingNote}</div>}
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <button
                  onClick={() => setIsSlipModalOpen(false)}
                  className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  ปิด
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ============ BATCH RECEIVE MODAL ============ */}
      <Modal
        isOpen={isBatchReceiveModalOpen}
        onClose={() => !batchSubmitting && setIsBatchReceiveModalOpen(false)}
        title={`ตรวจรับสินค้า${receivingBatch[0]?.batchNumber ? ` - ${receivingBatch[0].batchNumber}` : ''}`}
        size="lg"
      >
        {receivingBatch.length > 0 && (
          <form onSubmit={handleBatchReceiveSubmit} className="space-y-4">
            {/* Batch info */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">จาก: <span className="font-medium text-gray-800">{receivingBatch[0].fromBranch.name}</span></span>
                <span className="text-gray-500">ไป: <span className="font-medium text-gray-800">{receivingBatch[0].toBranch.name}</span></span>
              </div>
              <div className="text-xs text-gray-400 mt-1">{receivingBatch.length} รายการ</div>
            </div>

            {/* Per-item QC */}
            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              {receivingBatch.map((t, idx) => {
                const s = itemStatuses[t.id];
                if (!s) return null;
                return (
                  <div key={t.id} className={`border rounded-lg p-3 ${s.status === 'REJECT' ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                    {/* Item header */}
                    <div className="flex items-start gap-3 mb-2">
                      <span className="text-xs text-gray-400 mt-0.5 w-5 flex-shrink-0">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{t.product.brand} {t.product.model}</div>
                        <div className="text-xs text-gray-500">
                          {t.product.imeiSerial && <span className="font-mono">IMEI: {t.product.imeiSerial} </span>}
                          {t.product.color && <span>สี: {t.product.color} </span>}
                          {t.product.storage && <span>{t.product.storage}</span>}
                        </div>
                      </div>
                      {/* PASS/REJECT toggle */}
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => updateItemStatus(t.id, 'status', 'PASS')}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            s.status === 'PASS' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-green-100'
                          }`}
                        >
                          ผ่าน
                        </button>
                        <button
                          type="button"
                          onClick={() => updateItemStatus(t.id, 'status', 'REJECT')}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            s.status === 'REJECT' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-red-100'
                          }`}
                        >
                          ไม่ผ่าน
                        </button>
                      </div>
                    </div>

                    {/* IMEI scan if product has IMEI */}
                    {t.product.imeiSerial && (
                      <div className="ml-8 mb-2">
                        <input
                          type="text"
                          value={s.imei}
                          onChange={(e) => updateItemStatus(t.id, 'imei', e.target.value)}
                          placeholder="สแกน IMEI ยืนยัน"
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                        />
                        {s.imei && s.imei === t.product.imeiSerial && (
                          <span className="text-xs text-green-600">IMEI ตรงกัน</span>
                        )}
                        {s.imei && s.imei !== t.product.imeiSerial && (
                          <span className="text-xs text-red-600">IMEI ไม่ตรง!</span>
                        )}
                      </div>
                    )}

                    {/* Condition notes */}
                    <div className="ml-8">
                      <input
                        type="text"
                        value={s.conditionNotes}
                        onChange={(e) => updateItemStatus(t.id, 'conditionNotes', e.target.value)}
                        placeholder="หมายเหตุสภาพ"
                        className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                      />
                    </div>

                    {/* Reject reason */}
                    {s.status === 'REJECT' && (
                      <div className="ml-8 mt-1">
                        <input
                          type="text"
                          value={s.rejectReason}
                          onChange={(e) => updateItemStatus(t.id, 'rejectReason', e.target.value)}
                          placeholder="เหตุผลที่ไม่ผ่าน *"
                          className="w-full px-2 py-1 border border-red-300 rounded text-xs"
                          required
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Batch notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุรวม</label>
              <textarea
                value={batchReceiveNotes}
                onChange={(e) => setBatchReceiveNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
                placeholder="หมายเหตุสำหรับใบโอนนี้"
              />
            </div>

            {/* Summary & Submit */}
            <div className="border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between mb-3 text-sm">
                <span className="text-gray-500">
                  ผ่าน: <span className="text-green-600 font-medium">{Object.values(itemStatuses).filter((s) => s.status === 'PASS').length}</span>
                  {' / '}
                  ไม่ผ่าน: <span className="text-red-600 font-medium">{Object.values(itemStatuses).filter((s) => s.status === 'REJECT').length}</span>
                </span>
              </div>
              <button
                type="submit"
                disabled={batchSubmitting}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {batchSubmitting ? 'กำลังบันทึก...' : `ยืนยันตรวจรับ ${receivingBatch.length} รายการ`}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
