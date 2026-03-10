import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';

const getErrorMessage = (err: unknown) => {
  const error = err as { response?: { data?: { message?: string } } };
  return error?.response?.data?.message || 'เกิดข้อผิดพลาด';
};

interface StockCountItem {
  id: string;
  productId: string;
  expectedStatus: string;
  actualFound: boolean;
  conditionNotes: string | null;
  scannedImei: string | null;
  product: {
    id: string;
    name: string;
    brand: string;
    model: string;
    imeiSerial: string | null;
    serialNumber: string | null;
    status: string;
    costPrice: number;
  };
}

interface StockCount {
  id: string;
  countNumber: string;
  status: string;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  branch: { id: string; name: string };
  countedBy: { id: string; name: string };
  items?: StockCountItem[];
  _count?: { items: number };
}

export default function StockCountPage() {
  const queryClient = useQueryClient();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCountModalOpen, setIsCountModalOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState<StockCount | null>(null);
  const [countItems, setCountItems] = useState<{ productId: string; actualFound: boolean; conditionNotes: string; scannedImei: string }[]>([]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
  });

  const { data: stockCounts, isLoading } = useQuery({
    queryKey: ['stock-counts', selectedBranch],
    queryFn: () => api.get('/stock-counts', { params: { branchId: selectedBranch || undefined } }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (branchId: string) => api.post('/stock-counts', { branchId }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      toast.success(`สร้างรายการตรวจนับ ${res.data.countNumber} สำเร็จ`);
      setIsCreateModalOpen(false);
      openCountModal(res.data);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: ({ id, items }: { id: string; items: typeof countItems }) =>
      api.post(`/stock-counts/${id}/submit`, { items }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      const v = res.data.variance;
      toast.success(`ตรวจนับเสร็จ: พบ ${v.found}/${v.totalExpected} ชิ้น, ขาด ${v.missing} ชิ้น`);
      setIsCountModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/stock-counts/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      toast.success('ยกเลิกรายการตรวจนับแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openCountModal = async (sc: StockCount) => {
    try {
      const res = await api.get(`/stock-counts/${sc.id}`);
      const detail = res.data;
      setSelectedCount(detail);
      setCountItems(
        detail.items.map((i: StockCountItem) => ({
          productId: i.productId,
          actualFound: i.actualFound,
          conditionNotes: i.conditionNotes || '',
          scannedImei: i.scannedImei || '',
        })),
      );
      setIsCountModalOpen(true);
    } catch {
      toast.error('โหลดรายละเอียดไม่สำเร็จ');
    }
  };

  const updateItem = (idx: number, field: string, value: unknown) => {
    setCountItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCount) return;
    submitMutation.mutate({ id: selectedCount.id, items: countItems });
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
  };

  const counts: StockCount[] = stockCounts?.data || [];

  return (
    <div>
      <PageHeader title="ตรวจนับสต๊อก" subtitle="ตรวจนับสินค้าจริงเทียบกับในระบบ" />

      <div className="flex items-center gap-3 mb-4">
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
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
        >
          + สร้างรายการตรวจนับ
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
      ) : counts.length === 0 ? (
        <div className="text-center py-10 text-gray-500">ยังไม่มีรายการตรวจนับ</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">เลขที่</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">สาขา</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ผู้ตรวจ</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">จำนวน</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">สถานะ</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">วันที่</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {counts.map((sc) => (
                <tr key={sc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{sc.countNumber}</td>
                  <td className="px-4 py-3">{sc.branch.name}</td>
                  <td className="px-4 py-3">{sc.countedBy.name}</td>
                  <td className="px-4 py-3 text-center">{sc._count?.items || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[sc.status] || 'bg-gray-100'}`}>
                      {sc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(sc.createdAt).toLocaleDateString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => openCountModal(sc)}
                        className="px-2 py-1 text-xs bg-primary-100 text-primary-700 rounded hover:bg-primary-200"
                      >
                        {sc.status === 'COMPLETED' ? 'ดูผล' : 'ตรวจนับ'}
                      </button>
                      {sc.status === 'IN_PROGRESS' && (
                        <button
                          onClick={() => cancelMutation.mutate(sc.id)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          ยกเลิก
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="สร้างรายการตรวจนับ">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">เลือกสาขาที่ต้องการตรวจนับ ระบบจะดึงรายการสินค้าที่อยู่ในสาขานั้นมาให้อัตโนมัติ</p>
          <div className="space-y-2">
            {(branches || []).map((b: { id: string; name: string }) => (
              <button
                key={b.id}
                onClick={() => createMutation.mutate(b.id)}
                disabled={createMutation.isPending}
                className="w-full p-3 border border-gray-200 rounded-lg text-left hover:bg-primary-50 hover:border-primary-300 transition-colors"
              >
                <span className="font-medium">{b.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Count Modal */}
      <Modal isOpen={isCountModalOpen} onClose={() => setIsCountModalOpen(false)} title={`ตรวจนับ - ${selectedCount?.countNumber || ''}`} size="xl">
        {selectedCount && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm text-primary-700">
              สาขา: <strong>{selectedCount.branch.name}</strong> | สินค้าที่ต้องนับ: <strong>{selectedCount.items?.length || 0}</strong> ชิ้น
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {(selectedCount.items || []).map((item, idx) => (
                <div
                  key={item.id}
                  className={`border rounded-lg p-3 ${
                    countItems[idx]?.actualFound ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{item.product.name}</div>
                      <div className="text-xs text-gray-500 font-mono">
                        {item.product.imeiSerial || item.product.serialNumber || '-'}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateItem(idx, 'actualFound', true)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          countItems[idx]?.actualFound ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        พบ
                      </button>
                      <button
                        type="button"
                        onClick={() => updateItem(idx, 'actualFound', false)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          !countItems[idx]?.actualFound ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        ไม่พบ
                      </button>
                    </div>
                  </div>
                  {!countItems[idx]?.actualFound && (
                    <input
                      type="text"
                      placeholder="หมายเหตุ (ถ้ามี)"
                      value={countItems[idx]?.conditionNotes || ''}
                      onChange={(e) => updateItem(idx, 'conditionNotes', e.target.value)}
                      className="mt-2 w-full px-2 py-1.5 border border-red-300 rounded text-sm"
                    />
                  )}
                </div>
              ))}
            </div>

            {selectedCount.status !== 'COMPLETED' && countItems.length > 0 && (
              <>
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex gap-4">
                    <span>ทั้งหมด: <strong>{countItems.length}</strong></span>
                    <span className="text-green-700">พบ: <strong>{countItems.filter((i) => i.actualFound).length}</strong></span>
                    <span className="text-red-700">ไม่พบ: <strong>{countItems.filter((i) => !i.actualFound).length}</strong></span>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitMutation.isPending}
                  className="w-full py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {submitMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันผลตรวจนับ'}
                </button>
              </>
            )}

            {selectedCount.status === 'COMPLETED' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                ตรวจนับเสร็จสิ้นแล้ว | พบ: {countItems.filter((i) => i.actualFound).length} | ไม่พบ: {countItems.filter((i) => !i.actualFound).length}
              </div>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
