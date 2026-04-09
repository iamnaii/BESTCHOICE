import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateShort } from '@/utils/formatters';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import QueryBoundary from '@/components/QueryBoundary';

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

  const { data: stockCounts, isLoading, isError, error, refetch } = useQuery({
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
    DRAFT: 'bg-muted text-foreground',
    IN_PROGRESS: 'bg-warning/10 text-warning dark:bg-warning/15',
    COMPLETED: 'bg-success/10 text-success dark:bg-success/15',
    CANCELLED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  };

  const counts: StockCount[] = stockCounts?.data || [];

  const stockCountColumns: Column<StockCount>[] = [
    { key: 'countNumber', label: 'เลขที่', render: (item) => <span className="font-mono text-xs">{item.countNumber}</span> },
    { key: 'branch', label: 'สาขา', render: (item) => item.branch?.name || '-' },
    { key: 'countedBy', label: 'ผู้ตรวจ', render: (item) => item.countedBy?.name || '-' },
    { key: 'itemCount', label: 'จำนวน', render: (item) => item._count?.items || '-' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (item) => (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[item.status] || 'bg-muted'}`}>
          {item.status}
        </span>
      ),
    },
    { key: 'createdAt', label: 'วันที่', render: (item) => <span className="text-xs text-muted-foreground">{formatDateShort(item.createdAt)}</span> },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <div className="flex gap-1 justify-center">
          <button
            onClick={(e) => { e.stopPropagation(); openCountModal(item); }}
            className="px-2 py-1 text-xs bg-primary/10 text-primary dark:bg-primary/15 rounded hover:bg-primary/20"
          >
            {item.status === 'COMPLETED' ? 'ดูผล' : 'ตรวจนับ'}
          </button>
          {item.status === 'IN_PROGRESS' && (
            <button
              onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(item.id); }}
              className="px-2 py-1 text-xs bg-destructive/10 text-destructive dark:bg-destructive/15 rounded hover:bg-red-200"
            >
              ยกเลิก
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="ตรวจนับสต๊อก" subtitle="ตรวจนับสินค้าจริงเทียบกับในระบบ" />

      <div className="flex items-center gap-3 mb-5">
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสาขา</option>
          {(branches || []).map((b: { id: string; name: string }) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + สร้างรายการตรวจนับ
        </button>
      </div>

      <QueryBoundary
        isLoading={isLoading && !stockCounts}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดการตรวจนับสต็อกได้"
      >
        <DataTable
          columns={stockCountColumns}
          data={counts}
          isLoading={isLoading}
          emptyMessage="ยังไม่มีการนับสต็อก"
        />
      </QueryBoundary>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="สร้างรายการตรวจนับ">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">เลือกสาขาที่ต้องการตรวจนับ ระบบจะดึงรายการสินค้าที่อยู่ในสาขานั้นมาให้อัตโนมัติ</p>
          <div className="space-y-2">
            {(branches || []).map((b: { id: string; name: string }) => (
              <button
                key={b.id}
                onClick={() => createMutation.mutate(b.id)}
                disabled={createMutation.isPending}
                className="w-full p-3 border border-border rounded-lg text-left hover:bg-primary/5 hover:border-primary/30 dark:hover:bg-primary/10 transition-colors"
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
            <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-3 text-sm text-primary">
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
                      <div className="text-xs text-muted-foreground font-mono">
                        {item.product.imeiSerial || item.product.serialNumber || '-'}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateItem(idx, 'actualFound', true)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          countItems[idx]?.actualFound ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        พบ
                      </button>
                      <button
                        type="button"
                        onClick={() => updateItem(idx, 'actualFound', false)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          !countItems[idx]?.actualFound ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground'
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
                <div className="bg-muted rounded-lg p-3 text-sm">
                  <div className="flex gap-4">
                    <span>ทั้งหมด: <strong>{countItems.length}</strong></span>
                    <span className="text-success">พบ: <strong>{countItems.filter((i) => i.actualFound).length}</strong></span>
                    <span className="text-destructive">ไม่พบ: <strong>{countItems.filter((i) => !i.actualFound).length}</strong></span>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitMutation.isPending}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันผลตรวจนับ'}
                </button>
              </>
            )}

            {selectedCount.status === 'COMPLETED' && (
              <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-3 text-sm text-success">
                ตรวจนับเสร็จสิ้นแล้ว | พบ: {countItems.filter((i) => i.actualFound).length} | ไม่พบ: {countItems.filter((i) => !i.actualFound).length}
              </div>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
