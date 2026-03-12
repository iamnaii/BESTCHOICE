import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

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

export default function SlipReviewPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [selectedEvidence, setSelectedEvidence] = useState<PaymentEvidence | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [approveMethod, setApproveMethod] = useState('BANK_TRANSFER');

  const { data: evidences = [], isLoading } = useQuery({
    queryKey: ['payment-evidences', statusFilter],
    queryFn: async () => {
      const res = await api.get(`/line-oa/evidence?status=${statusFilter}`);
      return res.data as PaymentEvidence[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      return api.post(`/line-oa/evidence/${evidenceId}/approve`, {
        amount: Number(approveAmount),
        paymentMethod: approveMethod,
        installmentNo: 1, // Will be determined server-side
        reviewNote,
      });
    },
    onSuccess: () => {
      toast.success('อนุมัติสลิปเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['payment-evidences'] });
      setSelectedEvidence(null);
      setReviewNote('');
      setApproveAmount('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      return api.post(`/line-oa/evidence/${evidenceId}/reject`, {
        reviewNote,
      });
    },
    onSuccess: () => {
      toast.success('ปฏิเสธสลิปเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['payment-evidences'] });
      setSelectedEvidence(null);
      setReviewNote('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
    };
    const labels: Record<string, string> = {
      PENDING_REVIEW: 'รอตรวจ',
      APPROVED: 'อนุมัติ',
      REJECTED: 'ปฏิเสธ',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-muted'}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="p-6">
      <PageHeader
        title="ตรวจสอบสลิปชำระเงิน"
        subtitle="สลิปที่ลูกค้าส่งผ่าน LINE OA"
      />

      {/* Status Filter */}
      <div className="flex gap-2 mb-6">
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
              className="bg-card rounded-xl shadow-xs shadow-black/5 border p-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                setSelectedEvidence(ev);
                setApproveAmount(ev.amount?.toString() || '');
              }}
            >
              <div className="flex justify-between items-start mb-3">
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
                  <span className="font-medium text-green-600">
                    {Number(ev.amount).toLocaleString()} บาท
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
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
            {/* Slip Image */}
            <div>
              <img
                src={selectedEvidence.imageUrl}
                alt="สลิปชำระเงิน"
                className="w-full rounded-lg border"
              />
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
