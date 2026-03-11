import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';

interface Receipt {
  id: string;
  receiptNumber: string;
  contractId: string;
  paymentId: string | null;
  receiptType: string;
  payerName: string;
  receiverName: string;
  amount: number;
  installmentNo: number | null;
  remainingBalance: number | null;
  remainingMonths: number | null;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidDate: string;
  isVoided: boolean;
  voidReason: string | null;
  fileHash: string | null;
  createdAt: string;
}

const receiptTypeLabels: Record<string, string> = {
  INSTALLMENT: 'งวดผ่อนชำระ',
  DOWN_PAYMENT: 'เงินดาวน์',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

function ReceiptsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchContractId, setSearchContractId] = useState('');
  const [searchReceiptNo, setSearchReceiptNo] = useState('');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<Receipt | null>(null);

  const searchByContract = async () => {
    if (!searchContractId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/receipts/contract/${searchContractId}`);
      setReceipts(data);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const searchByNumber = async () => {
    if (!searchReceiptNo) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/receipts/number/${searchReceiptNo}`);
      setReceipts([data]);
    } catch (err) {
      toast.error(getErrorMessage(err));
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  };

  const voidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReceipt) return;
      await api.post(`/receipts/${selectedReceipt.id}/void`, { reason: voidReason });
    },
    onSuccess: () => {
      toast.success('ยกเลิกใบเสร็จสำเร็จ (สร้างใบลดหนี้แล้ว)');
      setShowVoidModal(false);
      setSelectedReceipt(null);
      setVoidReason('');
      if (searchContractId) searchByContract();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="ใบเสร็จรับเงิน (e-Receipt)"
        subtitle="ค้นหาและจัดการใบเสร็จรับเงินอิเล็กทรอนิกส์"
      />

      {/* Search */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Contract ID..."
              value={searchContractId}
              onChange={(e) => setSearchContractId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchByContract()}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            />
            <button onClick={searchByContract} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              ค้นหาตามสัญญา
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="เลขใบเสร็จ (RC-YYYY-MM-NNNNN)..."
              value={searchReceiptNo}
              onChange={(e) => setSearchReceiptNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchByNumber()}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            />
            <button onClick={searchByNumber} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              ค้นหาเลขใบเสร็จ
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      )}

      {!loading && receipts.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">เลขใบเสร็จ</th>
                <th className="px-4 py-3 text-left">ประเภท</th>
                <th className="px-4 py-3 text-left">ผู้ชำระ</th>
                <th className="px-4 py-3 text-right">จำนวนเงิน</th>
                <th className="px-4 py-3 text-left">งวดที่</th>
                <th className="px-4 py-3 text-left">วิธีชำระ</th>
                <th className="px-4 py-3 text-left">วันที่</th>
                <th className="px-4 py-3 text-left">สถานะ</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {receipts.map((r) => (
                <tr key={r.id} className={r.isVoided ? 'bg-red-50 opacity-60' : ''}>
                  <td className="px-4 py-3 font-mono text-xs">{r.receiptNumber}</td>
                  <td className="px-4 py-3 text-xs">{receiptTypeLabels[r.receiptType] || r.receiptType}</td>
                  <td className="px-4 py-3">{r.payerName}</td>
                  <td className="px-4 py-3 text-right font-medium">{Number(r.amount).toLocaleString()} ฿</td>
                  <td className="px-4 py-3 text-center">{r.installmentNo || '-'}</td>
                  <td className="px-4 py-3 text-xs">{r.paymentMethod || '-'}</td>
                  <td className="px-4 py-3 text-xs">{new Date(r.paidDate).toLocaleDateString('th-TH')}</td>
                  <td className="px-4 py-3">
                    {r.isVoided ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิก</span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">ปกติ</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSelectedDetail(r)}
                        className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded"
                      >
                        ดูรายละเอียด
                      </button>
                      {!r.isVoided && r.receiptType !== 'CREDIT_NOTE' && (user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER') && (
                        <button
                          onClick={() => { setSelectedReceipt(r); setVoidReason(''); setShowVoidModal(true); }}
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
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

      {!loading && receipts.length === 0 && (searchContractId || searchReceiptNo) && (
        <div className="text-center py-10 text-gray-400 text-sm">ไม่พบใบเสร็จ</div>
      )}

      {/* Receipt Detail Modal */}
      {selectedDetail && (
        <Modal title={`ใบเสร็จ ${selectedDetail.receiptNumber}`} onClose={() => setSelectedDetail(null)}>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-500">เลขใบเสร็จ:</span> <span className="font-mono">{selectedDetail.receiptNumber}</span></div>
              <div><span className="text-gray-500">ประเภท:</span> {receiptTypeLabels[selectedDetail.receiptType] || selectedDetail.receiptType}</div>
              <div><span className="text-gray-500">ผู้ชำระ:</span> {selectedDetail.payerName}</div>
              <div><span className="text-gray-500">ผู้รับ:</span> {selectedDetail.receiverName}</div>
              <div><span className="text-gray-500">จำนวนเงิน:</span> <span className="font-bold">{Number(selectedDetail.amount).toLocaleString()} ฿</span></div>
              <div><span className="text-gray-500">งวดที่:</span> {selectedDetail.installmentNo || '-'}</div>
              <div><span className="text-gray-500">ยอดคงเหลือ:</span> {selectedDetail.remainingBalance != null ? `${Number(selectedDetail.remainingBalance).toLocaleString()} ฿` : '-'}</div>
              <div><span className="text-gray-500">งวดคงเหลือ:</span> {selectedDetail.remainingMonths ?? '-'}</div>
              <div><span className="text-gray-500">วิธีชำระ:</span> {selectedDetail.paymentMethod || '-'}</div>
              <div><span className="text-gray-500">เลขอ้างอิง:</span> {selectedDetail.transactionRef || '-'}</div>
              <div><span className="text-gray-500">วันที่ชำระ:</span> {new Date(selectedDetail.paidDate).toLocaleString('th-TH')}</div>
              <div><span className="text-gray-500">วันที่ออก:</span> {new Date(selectedDetail.createdAt).toLocaleString('th-TH')}</div>
            </div>
            {selectedDetail.fileHash && (
              <div className="mt-3 p-2 bg-gray-50 rounded text-xs">
                <span className="text-gray-500">File Hash (SHA-256):</span>
                <div className="font-mono break-all mt-1">{selectedDetail.fileHash}</div>
              </div>
            )}
            {selectedDetail.isVoided && (
              <div className="mt-3 p-3 bg-red-50 rounded border border-red-200">
                <div className="text-red-700 font-medium text-xs">ใบเสร็จนี้ถูกยกเลิกแล้ว</div>
                {selectedDetail.voidReason && <div className="text-red-600 text-xs mt-1">เหตุผล: {selectedDetail.voidReason}</div>}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Void Modal */}
      {showVoidModal && selectedReceipt && (
        <Modal title="ยกเลิกใบเสร็จ" onClose={() => setShowVoidModal(false)}>
          <div className="space-y-4">
            <div className="bg-yellow-50 p-3 rounded border border-yellow-200 text-sm text-yellow-800">
              การยกเลิกใบเสร็จจะสร้างใบลดหนี้ (Credit Note) อัตโนมัติ ใบเสร็จเดิมจะไม่ถูกลบ
            </div>
            <div className="text-sm">
              <div>ใบเสร็จ: <span className="font-mono">{selectedReceipt.receiptNumber}</span></div>
              <div>จำนวนเงิน: {Number(selectedReceipt.amount).toLocaleString()} ฿</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">เหตุผลในการยกเลิก *</label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ระบุเหตุผล..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => voidMutation.mutate()}
                disabled={!voidReason || voidMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {voidMutation.isPending ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
              </button>
              <button onClick={() => setShowVoidModal(false)} className="px-4 py-2 text-sm border rounded-lg">
                ไม่ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ReceiptsPage;
