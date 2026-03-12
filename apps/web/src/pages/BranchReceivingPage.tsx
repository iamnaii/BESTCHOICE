import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';

const getErrorMessage = (err: unknown) => {
  const error = err as { response?: { data?: { message?: string } } };
  return error?.response?.data?.message || 'เกิดข้อผิดพลาด';
};

interface Transfer {
  id: string;
  status: string;
  dispatchedAt: string | null;
  trackingNote: string | null;
  product: {
    id: string;
    name: string;
    brand: string;
    model: string;
    imeiSerial: string | null;
    serialNumber: string | null;
    color: string | null;
    storage: string | null;
    photos: string[];
  };
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  dispatchedBy?: { id: string; name: string };
}

export default function BranchReceivingPage() {
  const queryClient = useQueryClient();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [scannedImei, setScannedImei] = useState('');
  const [status, setStatus] = useState<'PASS' | 'REJECT'>('PASS');
  const [conditionNotes, setConditionNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [notes, setNotes] = useState('');

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
  });

  const { data: pendingDeliveries, isLoading: loadingPending } = useQuery({
    queryKey: ['branch-receiving-pending', selectedBranch],
    queryFn: () => api.get('/branch-receiving/pending-deliveries', { params: { branchId: selectedBranch } }).then((r) => r.data),
    enabled: !!selectedBranch,
  });

  const { data: receivingHistory } = useQuery({
    queryKey: ['branch-receiving-history', selectedBranch],
    queryFn: () => api.get('/branch-receiving', { params: { branchId: selectedBranch || undefined } }).then((r) => r.data),
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

  const openReceiveModal = (transfer: Transfer) => {
    setSelectedTransfer(transfer);
    setScannedImei('');
    setStatus('PASS');
    setConditionNotes('');
    setRejectReason('');
    setNotes('');
    setIsReceiveModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    if (status === 'REJECT' && !rejectReason) {
      toast.error('กรุณาระบุเหตุผลที่ไม่ผ่าน');
      return;
    }
    receiveMutation.mutate({
      transferId: selectedTransfer.id,
      items: [{
        productId: selectedTransfer.product.id,
        imeiSerial: scannedImei || undefined,
        status,
        conditionNotes: conditionNotes || undefined,
        rejectReason: status === 'REJECT' ? rejectReason : undefined,
      }],
      notes: notes || undefined,
    });
  };

  const pendingList: Transfer[] = pendingDeliveries || [];
  const historyList = receivingHistory?.data || [];

  return (
    <div>
      <PageHeader title="สาขาเช็ครับสินค้า" subtitle="ตรวจรับสินค้าที่โอนมาจากคลังกลาง" />

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
        <div className="text-center py-10 text-gray-500">กรุณาเลือกสาขา</div>
      ) : (
        <div className="space-y-6">
          {/* Pending Deliveries */}
          <div>
            <h3 className="text-lg font-semibold mb-3">รอรับเข้า ({pendingList.length})</h3>
            {loadingPending ? (
              <div className="text-center py-4 text-gray-500">กำลังโหลด...</div>
            ) : pendingList.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-sm">ไม่มีสินค้ารอรับ</div>
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
                      {t.trackingNote && <div className="text-xs text-primary-600 mt-1">{t.trackingNote}</div>}
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

          {/* History */}
          <div>
            <h3 className="text-lg font-semibold mb-3">ประวัติการรับ</h3>
            {historyList.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-sm">ยังไม่มีประวัติ</div>
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
        </div>
      )}

      {/* Receive Modal */}
      <Modal isOpen={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)} title="ตรวจรับสินค้า">
        {selectedTransfer && (
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  onClick={() => setStatus('PASS')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    status === 'PASS' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                  }`}
                >
                  ผ่าน - รับเข้าสาขา
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('REJECT')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    status === 'REJECT' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100'
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

            {status === 'REJECT' && (
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
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
              />
            </div>

            <button
              type="submit"
              disabled={receiveMutation.isPending}
              className={`w-full py-2 rounded-lg font-medium text-white ${
                status === 'PASS' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              } disabled:opacity-50`}
            >
              {receiveMutation.isPending ? 'กำลังบันทึก...' : status === 'PASS' ? 'ยืนยันรับเข้าสาขา' : 'ปฏิเสธ - ส่งกลับคลัง'}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
