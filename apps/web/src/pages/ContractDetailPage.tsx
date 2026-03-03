import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import DocumentUpload from '@/components/contract/DocumentUpload';
import CreditCheckPanel from '@/components/contract/CreditCheckPanel';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

interface ContractDetail {
  id: string;
  contractNumber: string;
  status: string;
  workflowStatus: string;
  planType: string;
  sellingPrice: string;
  downPayment: string;
  interestRate: string;
  totalMonths: number;
  interestTotal: string;
  financedAmount: string;
  monthlyPayment: string;
  paymentDueDay: number | null;
  notes: string | null;
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  salespersonId: string;
  customer: { id: string; name: string; phone: string; nationalId: string };
  product: { id: string; name: string; brand: string; model: string; serialNumber: string | null; imeiSerial: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  interestConfig: { id: string; name: string } | null;
  payments: Payment[];
  signatures: { id: string; signerType: string; signedAt: string }[];
  contractDocuments: any[];
  creditCheck: any;
}

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-purple-100 text-purple-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
};

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-gray-100 text-gray-700' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showPayoffModal, setShowPayoffModal] = useState(false);
  const [payoffMethod, setPayoffMethod] = useState('CASH');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'schedule' | 'documents' | 'credit'>('schedule');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ sellingPrice: 0, downPayment: 0, totalMonths: 0, interestRate: 0, paymentDueDay: 1, notes: '' });

  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: payoffQuote } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/early-payoff-quote`); return data; },
    enabled: !!contract && ['ACTIVE', 'OVERDUE'].includes(contract.status),
  });

  const invalidateContract = () => queryClient.invalidateQueries({ queryKey: ['contract', id] });

  const submitReviewMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/submit-review`); return data; },
    onSuccess: () => { toast.success('ส่งตรวจสอบแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const approveMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/approve`, { reviewNotes: approveNotes || undefined }); return data; },
    onSuccess: () => { toast.success('อนุมัติสัญญาแล้ว'); invalidateContract(); setApproveNotes(''); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/reject`, { reviewNotes: rejectNotes }); return data; },
    onSuccess: () => { toast.success('ปฏิเสธสัญญาแล้ว'); invalidateContract(); setShowRejectModal(false); setRejectNotes(''); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const earlyPayoffMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/early-payoff`, { paymentMethod: payoffMethod });
      return data;
    },
    onSuccess: () => {
      toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ');
      setShowPayoffModal(false);
      invalidateContract();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch(`/contracts/${id}`, editForm);
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสัญญาสำเร็จ');
      setIsEditing(false);
      invalidateContract();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const startEditing = () => {
    if (!contract) return;
    setEditForm({
      sellingPrice: parseFloat(contract.sellingPrice),
      downPayment: parseFloat(contract.downPayment),
      totalMonths: contract.totalMonths,
      interestRate: parseFloat(contract.interestRate),
      paymentDueDay: contract.paymentDueDay || 1,
      notes: contract.notes || '',
    });
    setIsEditing(true);
  };

  if (isLoading || !contract) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const s = statusLabels[contract.status] || { label: contract.status, className: 'bg-gray-100' };
  const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
  const isReviewer = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role) && contract.salespersonId !== user.id;
  const isCreator = user && contract.salespersonId === user.id;
  const canEdit = isCreator && (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
  const customerSigned = contract.signatures?.some((s) => s.signerType === 'CUSTOMER');
  const staffSigned = contract.signatures?.some((s) => s.signerType === 'STAFF');
  const allSigned = customerSigned && staffSigned;

  const paymentColumns = [
    { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{new Date(p.dueDate).toLocaleDateString('th-TH')}</span> },
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{parseFloat(p.amountDue).toLocaleString()} ฿</span> },
    {
      key: 'amountPaid',
      label: 'ยอดที่ชำระ',
      render: (p: Payment) => p.amountPaid ? <span className="text-sm text-green-600">{parseFloat(p.amountPaid).toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: Payment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Payment) => {
        const ps = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>{ps.label}</span>;
      },
    },
    {
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: Payment) => p.paidDate ? <span className="text-xs">{new Date(p.paidDate).toLocaleDateString('th-TH')}</span> : <span className="text-xs text-gray-400">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={contract.contractNumber}
        subtitle="รายละเอียดสัญญาผ่อนชำระ"
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
              ลงนาม/เอกสาร
            </button>

            {/* Workflow buttons */}
            {(contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED') && isCreator && (
              <button onClick={() => submitReviewMutation.mutate()} disabled={submitReviewMutation.isPending} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ส่งตรวจสอบ'}
              </button>
            )}

            {contract.workflowStatus === 'APPROVED' && contract.status === 'DRAFT' && (
              <button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending || !allSigned} title={!allSigned ? 'ต้องลงนามครบทั้งลูกค้าและพนักงานก่อน' : ''} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}

            {['ACTIVE', 'OVERDUE'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                ปิดก่อนกำหนด
              </button>
            )}
            <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
              กลับ
            </button>
          </div>
        }
      />

      {/* Status + Workflow + Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">สถานะสัญญา</div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">Workflow</div>
          <WorkflowStatusBadge status={contract.workflowStatus} />
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ค่างวด/เดือน</div>
          <div className="text-xl font-bold text-primary-700">{parseFloat(contract.monthlyPayment).toLocaleString()} ฿</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ชำระแล้ว</div>
          <div className="text-xl font-bold text-green-600">{paidCount}/{contract.totalMonths} งวด</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ยอดผ่อนรวม</div>
          <div className="text-xl font-bold">{parseFloat(contract.financedAmount).toLocaleString()} ฿</div>
        </div>
      </div>

      {/* Workflow Actions for Reviewer */}
      {contract.workflowStatus === 'PENDING_REVIEW' && isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">รอการตรวจสอบจากคุณ</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-amber-700 mb-1">หมายเหตุ (ไม่บังคับ)</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="หมายเหตุการอนุมัติ..."
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติสัญญา'}
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                className="px-6 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection notes */}
      {contract.workflowStatus === 'REJECTED' && contract.reviewNotes && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-red-800">สัญญาถูกปฏิเสธ</h3>
          <div className="text-sm text-red-700 mt-1">เหตุผล: {contract.reviewNotes}</div>
          {contract.reviewedBy && <div className="text-xs text-red-500 mt-1">โดย: {contract.reviewedBy.name} | {contract.reviewedAt && new Date(contract.reviewedAt).toLocaleString('th-TH')}</div>}
        </div>
      )}

      {/* Signing guide for CREATING/REJECTED (sign first, review later) */}
      {(contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED') && contract.status === 'DRAFT' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-blue-800">ขั้นตอน: ให้ลูกค้าเซ็นสัญญา แล้วส่งตรวจสอบ</h3>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <span className="font-medium text-blue-700">ลงนาม:</span>
            <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
              ลูกค้า {customerSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
            </span>
            <span className={staffSigned ? 'text-green-700' : 'text-amber-600'}>
              พนักงาน {staffSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
            </span>
            {!allSigned && (
              <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">
                ไปลงนาม
              </button>
            )}
            {allSigned && isCreator && (
              <button onClick={() => submitReviewMutation.mutate()} disabled={submitReviewMutation.isPending} className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 disabled:opacity-50">
                {submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ส่งตรวจสอบ'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pending review info */}
      {contract.workflowStatus === 'PENDING_REVIEW' && !isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800">รอผู้จัดการตรวจสอบสัญญา</h3>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
              ลูกค้า {customerSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
            </span>
            <span className={staffSigned ? 'text-green-700' : 'text-amber-600'}>
              พนักงาน {staffSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
            </span>
          </div>
        </div>
      )}

      {/* Approved info */}
      {contract.workflowStatus === 'APPROVED' && contract.reviewedBy && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-green-800">สัญญาอนุมัติแล้ว</h3>
          <div className="text-xs text-green-600 mt-1">
            อนุมัติโดย: {contract.reviewedBy.name} | {contract.reviewedAt && new Date(contract.reviewedAt).toLocaleString('th-TH')}
            {contract.reviewNotes && ` | หมายเหตุ: ${contract.reviewNotes}`}
          </div>
          {/* Signature status */}
          {contract.status === 'DRAFT' && (
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="font-medium text-green-700">ลงนาม:</span>
              <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
                ลูกค้า {customerSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
              </span>
              <span className={staffSigned ? 'text-green-700' : 'text-amber-600'}>
                พนักงาน {staffSigned ? 'เซ็นแล้ว' : 'ยังไม่เซ็น'}
              </span>
              {!allSigned && (
                <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">
                  ไปลงนาม
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contract Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">ข้อมูลสัญญา</h2>
            {canEdit && !isEditing && (
              <button onClick={startEditing} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                แก้ไข
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ราคาขาย</label>
                  <input type="number" value={editForm.sellingPrice} onChange={(e) => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เงินดาวน์</label>
                  <input type="number" value={editForm.downPayment} onChange={(e) => setEditForm({ ...editForm, downPayment: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">จำนวนงวด (เดือน)</label>
                  <input type="number" value={editForm.totalMonths} onChange={(e) => setEditForm({ ...editForm, totalMonths: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">อัตราดอกเบี้ย (ทศนิยม เช่น 0.08)</label>
                  <input type="number" step="0.01" value={editForm.interestRate} onChange={(e) => setEditForm({ ...editForm, interestRate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">วันชำระ (1-28)</label>
                  <input type="number" min={1} max={28} value={editForm.paymentDueDay} onChange={(e) => setEditForm({ ...editForm, paymentDueDay: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {/* Preview calculation */}
              {editForm.sellingPrice > 0 && editForm.downPayment >= 0 && editForm.totalMonths > 0 && editForm.downPayment < editForm.sellingPrice && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                  <div>เงินต้น: {(editForm.sellingPrice - editForm.downPayment).toLocaleString()} ฿</div>
                  <div>ดอกเบี้ยรวม: {((editForm.sellingPrice - editForm.downPayment) * editForm.interestRate * editForm.totalMonths).toLocaleString()} ฿</div>
                  <div className="font-semibold">ค่างวด/เดือน: {Math.ceil(((editForm.sellingPrice - editForm.downPayment) * (1 + editForm.interestRate * editForm.totalMonths)) / editForm.totalMonths).toLocaleString()} ฿</div>
                </div>
              )}
              {editForm.totalMonths <= 0 && <div className="text-xs text-red-600">จำนวนงวดต้องมากกว่า 0</div>}
              {editForm.downPayment >= editForm.sellingPrice && editForm.sellingPrice > 0 && <div className="text-xs text-red-600">เงินดาวน์ต้องน้อยกว่าราคาขาย</div>}
              {editForm.sellingPrice <= 0 && <div className="text-xs text-red-600">ราคาขายต้องมากกว่า 0</div>}
              {(editForm.paymentDueDay < 1 || editForm.paymentDueDay > 28) && <div className="text-xs text-red-600">วันชำระต้องอยู่ระหว่าง 1-28</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
                <button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending || editForm.totalMonths <= 0 || editForm.sellingPrice <= 0 || editForm.downPayment >= editForm.sellingPrice || editForm.paymentDueDay < 1 || editForm.paymentDueDay > 28}
                  className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Info label="ประเภทแผน" value={contract.planType} />
              <Info label="ราคาขาย" value={`${parseFloat(contract.sellingPrice).toLocaleString()} ฿`} />
              <Info label="เงินดาวน์" value={`${parseFloat(contract.downPayment).toLocaleString()} ฿`} />
              <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%${contract.interestConfig ? ` (${contract.interestConfig.name})` : ''}`} />
              <Info label="ดอกเบี้ยรวม" value={`${parseFloat(contract.interestTotal).toLocaleString()} ฿`} />
              <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
              <Info label="วันชำระ" value={contract.paymentDueDay ? `ทุกวันที่ ${contract.paymentDueDay}` : 'วันที่ 1'} />
              <Info label="พนักงานขาย" value={contract.salesperson.name} />
              <Info label="สาขา" value={contract.branch.name} />
              <Info label="วันที่สร้าง" value={new Date(contract.createdAt).toLocaleDateString('th-TH')} />
              {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลลูกค้า</h2>
            <div className="grid grid-cols-2 gap-3">
              <Info label="ชื่อ" value={contract.customer.name} />
              <Info label="เบอร์โทร" value={contract.customer.phone} />
            </div>
            <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดลูกค้า</button>
          </div>

          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลสินค้า</h2>
            <div className="grid grid-cols-2 gap-3">
              <Info label="สินค้า" value={`${contract.product.brand} ${contract.product.model}`} />
              <Info label="ชื่อ" value={contract.product.name} />
              {contract.product.serialNumber && <Info label="S/N" value={contract.product.serialNumber} />}
              {contract.product.imeiSerial && <Info label="IMEI" value={contract.product.imeiSerial} />}
            </div>
            <button onClick={() => navigate(`/products/${contract.product.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดสินค้า</button>
          </div>
        </div>
      </div>

      {/* Early Payoff Quote */}
      {payoffQuote && ['ACTIVE', 'OVERDUE'].includes(contract.status) && (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-blue-800 mb-3">ประเมินปิดก่อนกำหนด</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><div className="text-xs text-blue-600">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
            <div><div className="text-xs text-blue-600">เงินต้นคงเหลือ</div><div className="font-medium">{payoffQuote.remainingPrincipal.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-blue-600">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{payoffQuote.remainingInterest.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-green-600">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-green-700">-{payoffQuote.discount.toLocaleString()} ฿</div></div>
            {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-red-600">ค่าปรับค้างชำระ</div><div className="font-medium text-red-700">{payoffQuote.unpaidLateFees.toLocaleString()} ฿</div></div>}
            <div><div className="text-xs text-blue-600 font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-blue-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div></div>
          </div>
        </div>
      )}

      {/* Tabs: Schedule / Documents / Credit Check */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedule' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ตารางผ่อน ({paidCount}/{contract.totalMonths})
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          เอกสาร ({contract.contractDocuments.length})
        </button>
        <button
          onClick={() => setActiveTab('credit')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'credit' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ตรวจเครดิต
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'schedule' && (
        <DataTable columns={paymentColumns} data={contract.payments} emptyMessage="ยังไม่มีตารางผ่อน" />
      )}

      {activeTab === 'documents' && (
        <DocumentUpload contractId={contract.id} customerId={contract.customer.id} />
      )}

      {activeTab === 'credit' && (
        <CreditCheckPanel contractId={contract.id} />
      )}

      {/* Early Payoff Modal */}
      {showPayoffModal && payoffQuote && (
        <Modal isOpen title="ปิดสัญญาก่อนกำหนด" onClose={() => setShowPayoffModal(false)}>
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-sm">ยอดที่ต้องชำระ</div>
              <div className="text-2xl font-bold text-blue-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div>
              <div className="text-xs text-blue-600 mt-1">(รวมส่วนลดดอกเบี้ย 50% แล้ว)</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วิธีชำระ</label>
              <select value={payoffMethod} onChange={(e) => setPayoffMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPayoffModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button onClick={() => earlyPayoffMutation.mutate()} disabled={earlyPayoffMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {earlyPayoffMutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <Modal isOpen title="ปฏิเสธสัญญา" onClose={() => setShowRejectModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผลที่ปฏิเสธ *</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="ระบุเหตุผลที่ปฏิเสธสัญญา..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowRejectModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectNotes.trim() || rejectMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-gray-500 mb-0.5">{label}</div><div className="text-sm text-gray-900">{value || '-'}</div></div>;
}
