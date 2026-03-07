import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
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
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
  const [scannedImei, setScannedImei] = useState('');
  const [receiveStatus, setReceiveStatus] = useState<'PASS' | 'REJECT'>('PASS');
  const [conditionNotes, setConditionNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');

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

  const confirmMutation = useMutation({
    mutationFn: async (transferId: string) => api.post(`/products/transfers/${transferId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('ยืนยันรับสินค้าเข้าสาขาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (transferId: string) => api.post(`/products/transfers/${transferId}/reject`),
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
    enabled: activeTab === 'incoming',
  });

  const { data: pendingDeliveries, isLoading: loadingPending } = useQuery({
    queryKey: ['branch-receiving-pending', selectedBranch],
    queryFn: () => api.get('/branch-receiving/pending-deliveries', { params: { branchId: selectedBranch } }).then((r) => r.data),
    enabled: activeTab === 'incoming' && !!selectedBranch,
  });

  const receiveMutation = useMutation({
    mutationFn: (data: {
      transferId: string;
      items: { productId: string; imeiSerial?: string; status: string; conditionNotes?: string; rejectReason?: string }[];
      notes?: string;
    }) => api.post('/branch-receiving', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['branch-receiving'] });
      queryClient.invalidateQueries({ queryKey: ['branch-receiving-pending'] });
      queryClient.invalidateQueries({ queryKey: ['branch-receiving-history'] });
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      const d = res.data;
      if (d.productMoved) {
        toast.success(`รับสินค้าเข้าสาขา ${d.toBranch} สำเร็จ`);
      } else {
        toast.error(`ปฏิเสธสินค้า - ส่งกลับคลัง`);
      }
      setIsReceiveModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // ============ HISTORY TAB QUERIES ============
  const { data: receivingHistory } = useQuery({
    queryKey: ['branch-receiving-history', selectedBranch],
    queryFn: () => api.get('/branch-receiving', { params: { branchId: selectedBranch || undefined } }).then((r) => r.data),
    enabled: activeTab === 'history',
  });

  // ============ HELPERS ============
  const openReceiveModal = (transfer: StockTransfer) => {
    setSelectedTransfer(transfer);
    setScannedImei('');
    setReceiveStatus('PASS');
    setConditionNotes('');
    setRejectReason('');
    setReceiveNotes('');
    setIsReceiveModalOpen(true);
  };

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    if (receiveStatus === 'REJECT' && !rejectReason) {
      toast.error('กรุณาระบุเหตุผลที่ไม่ผ่าน');
      return;
    }
    receiveMutation.mutate({
      transferId: selectedTransfer.id,
      items: [{
        productId: selectedTransfer.product.id,
        imeiSerial: scannedImei || undefined,
        status: receiveStatus,
        conditionNotes: conditionNotes || undefined,
        rejectReason: receiveStatus === 'REJECT' ? rejectReason : undefined,
      }],
      notes: receiveNotes || undefined,
    });
  };

  const pendingList: StockTransfer[] = pendingDeliveries || [];
  const historyList = receivingHistory?.data || [];

  // ============ OUTGOING COLUMNS ============
  const outgoingColumns = [
    {
      key: 'batchNumber',
      label: 'เลขใบโอน',
      render: (t: StockTransfer) => (
        <span className="text-xs font-mono font-medium text-blue-600">{t.batchNumber || '-'}</span>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (t: StockTransfer) => (
        <button
          onClick={() => navigate(`/products/${t.product.id}`)}
          className="text-left hover:underline"
        >
          <div className="text-primary-600 font-medium">{t.product.brand} {t.product.model}</div>
          {t.product.imeiSerial && (
            <div className="text-xs text-gray-400 font-mono">{t.product.imeiSerial}</div>
          )}
        </button>
      ),
    },
    {
      key: 'from',
      label: 'จากสาขา',
      render: (t: StockTransfer) => <span className="text-sm">{t.fromBranch.name}</span>,
    },
    {
      key: 'to',
      label: 'ไปสาขา',
      render: (t: StockTransfer) => <span className="text-sm font-medium">{t.toBranch.name}</span>,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (t: StockTransfer) => {
        const s = transferStatusLabels[t.status] || { label: t.status, className: 'bg-gray-100 text-gray-700' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่โอน',
      render: (t: StockTransfer) => (
        <div className="text-xs">
          <div>{new Date(t.createdAt).toLocaleString('th-TH')}</div>
          {t.dispatchedAt && (
            <div className="text-blue-500">ส่ง: {new Date(t.dispatchedAt).toLocaleString('th-TH')}</div>
          )}
        </div>
      ),
    },
    {
      key: 'confirmedBy',
      label: 'ยืนยันโดย',
      render: (t: StockTransfer) => (
        <div className="text-xs">
          {t.confirmedBy ? (
            <>
              <div>{t.confirmedBy.name}</div>
              {t.confirmedAt && <div className="text-gray-400">{new Date(t.confirmedAt).toLocaleString('th-TH')}</div>}
            </>
          ) : t.dispatchedBy ? (
            <div className="text-blue-600">จัดส่งโดย: {t.dispatchedBy.name}</div>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </div>
      ),
    },
    {
      key: 'notes',
      label: 'หมายเหตุ',
      render: (t: StockTransfer) => (
        <span className="text-xs text-gray-500">{t.trackingNote || t.notes || '-'}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (t: StockTransfer) => (
        <div className="flex gap-2">
          {t.status === 'PENDING' && (
            <button
              onClick={() => {
                const note = prompt('หมายเหตุการจัดส่ง (ถ้ามี):');
                if (note !== null) {
                  dispatchMutation.mutate({ transferId: t.id, trackingNote: note || undefined });
                }
              }}
              disabled={dispatchMutation.isPending}
              className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              จัดส่ง
            </button>
          )}
          {t.status === 'IN_TRANSIT' && (
            <>
              <button
                onClick={() => {
                  if (confirm(`ยืนยันรับสินค้า ${t.product.brand} ${t.product.model} เข้าสาขา ${t.toBranch.name}?`)) {
                    confirmMutation.mutate(t.id);
                  }
                }}
                disabled={confirmMutation.isPending}
                className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                ยืนยันรับ
              </button>
              <button
                onClick={() => {
                  if (confirm(`ปฏิเสธการโอน ${t.product.brand} ${t.product.model}?`)) {
                    rejectMutation.mutate(t.id);
                  }
                }}
                disabled={rejectMutation.isPending}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                ปฏิเสธ
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

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
              <option value="IN_TRANSIT">กำลังจัดส่ง</option>
              <option value="CONFIRMED">รับแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
              <option value="">ทั้งหมด</option>
            </select>
          </div>

          <DataTable
            columns={outgoingColumns}
            data={transfers}
            isLoading={loadingTransfers}
            emptyMessage={
              statusFilter === 'PENDING' ? 'ไม่มีรายการรอจัดส่ง'
              : statusFilter === 'IN_TRANSIT' ? 'ไม่มีรายการกำลังจัดส่ง'
              : 'ไม่พบรายการโอน'
            }
          />
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
          ) : pendingList.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">ไม่มีสินค้ารอรับเข้าสาขานี้</div>
          ) : (
            <div className="grid gap-3">
              {pendingList.map((t) => (
                <div key={t.id} className="bg-white border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.product.name}</div>
                    <div className="text-xs text-gray-500 space-x-3">
                      <span>จาก: {t.fromBranch.name}</span>
                      {t.product.imeiSerial && <span className="font-mono">IMEI: {t.product.imeiSerial}</span>}
                      {t.dispatchedAt && <span>จัดส่ง: {new Date(t.dispatchedAt).toLocaleDateString('th-TH')}</span>}
                    </div>
                    {t.trackingNote && <div className="text-xs text-blue-600 mt-1">{t.trackingNote}</div>}
                  </div>
                  <button
                    onClick={() => openReceiveModal(t)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                  >
                    ตรวจรับ
                  </button>
                </div>
              ))}
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

      {/* ============ RECEIVE MODAL ============ */}
      <Modal isOpen={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)} title="ตรวจรับสินค้า">
        {selectedTransfer && (
          <form onSubmit={handleReceiveSubmit} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="font-medium">{selectedTransfer.product.name}</div>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div>จาก: {selectedTransfer.fromBranch.name} → {selectedTransfer.toBranch.name}</div>
                {selectedTransfer.product.imeiSerial && (
                  <div className="font-mono">IMEI ที่ต้องตรง: {selectedTransfer.product.imeiSerial}</div>
                )}
              </div>
            </div>

            {selectedTransfer.product.imeiSerial && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">สแกน IMEI ยืนยัน</label>
                <input
                  type="text"
                  value={scannedImei}
                  onChange={(e) => setScannedImei(e.target.value)}
                  placeholder="สแกนหรือพิมพ์ IMEI"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                />
                {scannedImei && scannedImei === selectedTransfer.product.imeiSerial && (
                  <div className="text-xs text-green-600 mt-1">IMEI ตรงกัน</div>
                )}
                {scannedImei && scannedImei !== selectedTransfer.product.imeiSerial && (
                  <div className="text-xs text-red-600 mt-1">IMEI ไม่ตรง!</div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ผลตรวจ</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReceiveStatus('PASS')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    receiveStatus === 'PASS' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                  }`}
                >
                  ผ่าน - รับเข้าสาขา
                </button>
                <button
                  type="button"
                  onClick={() => setReceiveStatus('REJECT')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    receiveStatus === 'REJECT' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100'
                  }`}
                >
                  ไม่ผ่าน - ส่งกลับ
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุสภาพ</label>
              <input
                type="text"
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                placeholder="สภาพสินค้าตอนรับ"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {receiveStatus === 'REJECT' && (
              <div>
                <label className="block text-sm font-medium text-red-700 mb-1">เหตุผลที่ไม่ผ่าน *</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="เช่น หน้าจอแตก, สินค้าไม่ตรงตามรายการ"
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุเพิ่มเติม</label>
              <textarea
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
              />
            </div>

            <button
              type="submit"
              disabled={receiveMutation.isPending}
              className={`w-full py-2 rounded-lg font-medium text-white ${
                receiveStatus === 'PASS' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              } disabled:opacity-50`}
            >
              {receiveMutation.isPending ? 'กำลังบันทึก...' : receiveStatus === 'PASS' ? 'ยืนยันรับเข้าสาขา' : 'ปฏิเสธ - ส่งกลับคลัง'}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
