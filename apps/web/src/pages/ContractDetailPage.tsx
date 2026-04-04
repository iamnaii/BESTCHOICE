import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import DocumentUpload from '@/components/contract/DocumentUpload';
import CreditCheckPanel from '@/components/contract/CreditCheckPanel';
import ProductEditModal from '@/components/contract/ProductEditModal';
import CustomerEditModal from '@/components/contract/CustomerEditModal';
import { toast } from 'sonner';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import PaymentTimeline from '@/components/contract/PaymentTimeline';
import { DetailPageSkeleton } from '@/components/ui/page-skeletons';

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
  contractHash: string | null;
  pdpaConsentId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  salespersonId: string;
  customer: { id: string; name: string; phone: string; nationalId: string };
  customerSnapshot: { name: string; phone: string; nationalId?: string; prefix?: string; nickname?: string; occupation?: string; salary?: string } | null;
  product: { id: string; name: string; brand: string; model: string; category: string; color: string | null; storage: string | null; serialNumber: string | null; imeiSerial: string | null; costPrice: string; batteryHealth: number | null; warrantyExpired: boolean | null; warrantyExpireDate: string | null; hasBox: boolean | null; accessoryType: string | null; accessoryBrand: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  interestConfig: { id: string; name: string; storeCommissionPct?: string; vatPct?: string } | null;
  creditBalance: string | null;
  dunningStage: string | null;
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
  DRAFT: { label: 'ร่าง', className: 'bg-secondary text-foreground' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary/10 text-primary dark:bg-primary/15' },
  COMPLETED: { label: 'ครบ', className: 'bg-success/10 text-success dark:bg-success/15' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-info/10 text-info dark:bg-info/15' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-destructive/15 text-destructive dark:bg-destructive/20' },
};

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-secondary text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showPayoffModal, setShowPayoffModal] = useState(false);
  const [customerLink, setCustomerLink] = useState<string | null>(null);
  const [payoffMethod, setPayoffMethod] = useState('CASH');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'schedule' | 'documents' | 'credit' | 'preview'>('schedule');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ sellingPrice: 0, downPayment: 0, totalMonths: 0, interestRate: 0, paymentDueDay: 1, notes: '' });

  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: payoffQuote } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/early-payoff-quote`); return data; },
    enabled: !!contract && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status),
  });

  // E-Documents (generated PDFs)
  const { data: eDocuments = [] } = useQuery<{ id: string; documentType: string; fileUrl: string; fileHash: string; createdAt: string }[]>({
    queryKey: ['contract-edocuments', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/documents`); return data; },
  });

  const { data: preview, isLoading: previewLoading } = useQuery<{ html: string }>({
    queryKey: ['contract-preview', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/preview`); return data; },
    enabled: activeTab === 'preview',
  });

  const { data: docChecklist } = useQuery<{ complete: boolean; checklist: { type: string; label: string; present: boolean }[] }>({
    queryKey: ['contract-doc-checklist', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/documents/checklist`); return data; },
    enabled: !!contract && contract.workflowStatus === 'PENDING_REVIEW',
  });

  const invalidateContract = () => {
    queryClient.invalidateQueries({ queryKey: ['contract', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-preview', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-payoff', id] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  };

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      // Validate first
      try {
        const { data: validation } = await api.get(`/contracts/${id}/validate`);
        if (validation.errors && validation.errors.length > 0) {
          throw { isValidation: true, errors: validation.errors };
        }
      } catch (err: any) {
        if (err.isValidation) throw err;
        // If validate endpoint fails, proceed anyway (endpoint might not exist)
      }
      const { data } = await api.post(`/contracts/${id}/submit-review`);
      return data;
    },
    onSuccess: () => { toast.success('ส่งตรวจสอบแล้ว'); invalidateContract(); },
    onError: (err: any) => {
      if (err.isValidation) {
        toast.error(`สัญญาไม่ครบถ้วน: ${err.errors.join(', ')}`);
      } else {
        toast.error(getErrorMessage(err));
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/approve`, { reviewNotes: approveNotes || undefined }); return data; },
    onSuccess: () => { toast.success('อนุมัติสัญญาแล้ว'); invalidateContract(); setApproveNotes(''); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/reject`, { reviewNotes: rejectNotes }); return data; },
    onSuccess: () => { toast.success('ปฏิเสธสัญญาแล้ว'); invalidateContract(); setShowRejectModal(false); setRejectNotes(''); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
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
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { const { data } = await api.delete(`/contracts/${id}`); return data; },
    onSuccess: () => { toast.success('ลบสัญญาแล้ว'); navigate('/contracts'); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const customerLinkMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/customer-link`);
      return data;
    },
    onSuccess: (data: { url: string; token: string; expiresAt: string }) => {
      const link = `${window.location.origin}/customer-access/${data.token}`;
      setCustomerLink(link);
      toast.success('สร้างลิงก์สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Edit modal states
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title?: string; message: string; variant?: 'default' | 'destructive'; action: () => void }>({ open: false, message: '', action: () => {} });

  // No inline product/customer edit state needed — extracted to separate components

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
    return <DetailPageSkeleton />;
  }

  const s = statusLabels[contract.status] || { label: contract.status, className: 'bg-secondary' };
  const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
  const isReviewer = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role) && (user.role === 'OWNER' || contract.salespersonId !== user.id);
  const isCreator = user && contract.salespersonId === user.id;
  const isOwner = user?.role === 'OWNER';
  const canEdit = (isCreator || isOwner) && (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
  const canEditMaster = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const canDelete = isOwner && (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
  const signedTypes = new Set(contract.signatures?.map((s) => s.signerType === 'STAFF' ? 'COMPANY' : s.signerType) || []);
  const customerSigned = signedTypes.has('CUSTOMER');
  const companySigned = signedTypes.has('COMPANY');
  const witness1Signed = signedTypes.has('WITNESS_1');
  const witness2Signed = signedTypes.has('WITNESS_2');
  const allSigned = customerSigned && companySigned && witness1Signed && witness2Signed;

  const paymentColumns = [
    { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{new Date(p.dueDate).toLocaleDateString('th-TH')}</span> },
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{parseFloat(p.amountDue).toLocaleString()} ฿</span> },
    {
      key: 'amountPaid',
      label: 'ยอดที่ชำระ',
      render: (p: Payment) => p.amountPaid ? <span className="text-sm text-success">{parseFloat(p.amountPaid).toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: Payment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-sm text-destructive">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Payment) => {
        const ps = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-secondary' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>{ps.label}</span>;
      },
    },
    {
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: Payment) => p.paidDate ? <span className="text-xs">{new Date(p.paidDate).toLocaleDateString('th-TH')}</span> : <span className="text-xs text-muted-foreground">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={contract.contractNumber}
        subtitle="รายละเอียดสัญญาผ่อนชำระ"
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              ลงนาม/เอกสาร
            </button>
            <button
              onClick={() => {
                setActiveTab('preview');
                const tryPrint = (attempts = 0) => {
                  // Guard: stop polling if component/iframe no longer in DOM
                  const iframe = document.querySelector('iframe[title="contract-preview"]') as HTMLIFrameElement;
                  if (!iframe || !document.body.contains(iframe)) return;
                  if (iframe.contentWindow && iframe.contentDocument?.body?.innerHTML) {
                    // Wait for fonts to load inside iframe before printing
                    const iframeDoc = iframe.contentDocument;
                    const fontsReady = iframeDoc?.fonts?.ready;
                    if (fontsReady) {
                      fontsReady.then(() => iframe.contentWindow?.print()).catch(() => iframe.contentWindow?.print());
                    } else {
                      iframe.contentWindow.print();
                    }
                  } else if (attempts < 15) {
                    setTimeout(() => tryPrint(attempts + 1), 400);
                  } else {
                    window.print();
                  }
                };
                setTimeout(() => tryPrint(), 600);
              }}
              className="px-4 py-2 text-sm border border-input text-foreground rounded-lg hover:bg-muted"
            >
              พิมพ์สัญญา
            </button>

            {/* Workflow buttons */}
            {contract.workflowStatus === 'APPROVED' && contract.status === 'DRAFT' && (
              <button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending || !allSigned} title={!allSigned ? 'ต้องลงนามครบทั้งลูกค้าและพนักงานก่อน' : ''} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}

            {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                ปิดก่อนกำหนด
              </button>
            )}
            {['ACTIVE', 'OVERDUE', 'COMPLETED'].includes(contract.status) && (
              <button
                onClick={() => customerLinkMutation.mutate()}
                disabled={customerLinkMutation.isPending}
                className="px-4 py-2 text-sm border border-primary text-primary rounded-lg hover:bg-primary/10 disabled:opacity-50"
              >
                {customerLinkMutation.isPending ? 'กำลังสร้าง...' : 'ส่งลิงก์ลูกค้า'}
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirmDialog({ open: true, title: 'ลบสัญญา', message: 'ยืนยันลบสัญญานี้?', variant: 'destructive', action: () => deleteMutation.mutate() })}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบสัญญา'}
              </button>
            )}
            <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">
              กลับ
            </button>
          </div>
        }
      />

      {/* Workflow Stepper - only show for DRAFT contracts */}
      {contract.status === 'DRAFT' && (() => {
        const steps = [
          { label: 'สร้างสัญญา', done: true },
          { label: 'แนบเอกสาร', done: contract.contractDocuments.length >= 3 },
          { label: 'ลงนาม & PDPA', done: !!contract.pdpaConsentId && allSigned },
          { label: 'ตรวจสอบ & อนุมัติ', done: contract.workflowStatus === 'APPROVED' },
          { label: 'เปิดใช้งาน', done: false },
        ];
        const currentStep = steps.findIndex(s => !s.done);
        const stepHints: { text: string; action?: () => void; actionLabel?: string }[] = [
          { text: '' },
          { text: 'อัปโหลดเอกสารที่จำเป็น', action: () => setActiveTab('documents'), actionLabel: 'ไปแนบเอกสาร' },
          { text: 'ให้ลูกค้ายินยอม PDPA และลงนามสัญญา', action: () => navigate(`/contracts/${id}/sign`), actionLabel: 'ไปลงนาม' },
          {
            text: isCreator && allSigned ? 'ลงนามครบแล้ว พร้อมส่งตรวจสอบ' : !allSigned ? 'ลงนามให้ครบก่อนส่งตรวจสอบ' : 'รอผู้จัดการตรวจสอบสัญญา',
            action: isCreator && allSigned ? () => setShowSubmitConfirm(true) : undefined,
            actionLabel: isCreator && allSigned ? 'ส่งตรวจสอบ' : undefined,
          },
          {
            text: allSigned ? 'สัญญาอนุมัติแล้ว พร้อมเปิดใช้งาน' : 'ต้องลงนามครบก่อนเปิดใช้งาน',
            action: allSigned ? () => activateMutation.mutate() : undefined,
            actionLabel: allSigned ? 'เปิดใช้งานสัญญา' : undefined,
          },
        ];
        const hint = currentStep >= 0 ? stepHints[currentStep] : null;

        return (
          <div className="rounded-lg border p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step.done ? 'bg-green-600 text-white' : i === currentStep ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1' : 'bg-muted text-muted-foreground'}`}>
                      {step.done ? '✓' : i + 1}
                    </div>
                    <span className={`text-2xs md:text-xs text-center leading-tight ${step.done ? 'text-success font-medium' : i === currentStep ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 mt-[-16px] ${step.done ? 'bg-green-500' : 'bg-muted'}`} />
                  )}
                </div>
              ))}
            </div>
            {hint && hint.text && (
              <div className="flex items-center justify-between bg-primary/5 rounded-lg px-3 py-2 mt-1">
                <span className="text-sm text-primary">{hint.text}</span>
                {hint.action && hint.actionLabel && (
                  <button onClick={hint.action} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 shrink-0 ml-2">
                    {hint.actionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Status + Workflow + Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card className="border-l-[3px] border-l-primary">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะสัญญา</div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${s.className}`}>{s.label}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Workflow</div>
            <WorkflowStatusBadge status={contract.workflowStatus} />
          </CardContent>
        </Card>
        <Card className="border-l-[3px] border-l-primary">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่างวด/เดือน</div>
            <div className="text-xl font-bold text-primary">{parseFloat(contract.monthlyPayment).toLocaleString()} ฿</div>
          </CardContent>
        </Card>
        <Card className="border-l-[3px] border-l-success">
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชำระแล้ว</div>
            <div className="text-xl font-bold text-success">{paidCount}/{contract.totalMonths} งวด</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดผ่อนรวม</div>
            <div className="text-xl font-bold">{parseFloat(contract.financedAmount).toLocaleString()} ฿</div>
          </CardContent>
        </Card>
        {contract.creditBalance && parseFloat(contract.creditBalance) > 0 && (
          <div className="rounded-lg border border-success/20 bg-success/5 dark:bg-success/10 p-4">
            <div className="text-xs text-success mb-1">ยอดเครดิตคงเหลือ</div>
            <div className="text-xl font-bold text-success">{parseFloat(contract.creditBalance).toLocaleString()} ฿</div>
            {['ACTIVE', 'OVERDUE'].includes(contract.status) && (
              <button
                onClick={() => setConfirmDialog({
                  open: true,
                  title: 'ใช้เครดิตชำระ',
                  message: `ใช้เครดิต ${parseFloat(contract.creditBalance!).toLocaleString()} ฿ ชำระงวดถัดไป?`,
                  action: async () => {
                    try {
                      await api.post(`/payments/apply-credit/${contract.id}`);
                      toast.success('ใช้เครดิตชำระสำเร็จ');
                      invalidateContract();
                    } catch (err: unknown) {
                      toast.error(getErrorMessage(err));
                    }
                  },
                })}
                className="mt-2 px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                ใช้เครดิตชำระ
              </button>
            )}
          </div>
        )}
        {contract.dunningStage && contract.dunningStage !== 'NONE' && (
          <div className={`rounded-lg border p-4 ${
            contract.dunningStage === 'LEGAL_ACTION' ? 'border-red-400 bg-red-50' :
            contract.dunningStage === 'FINAL_WARNING' ? 'border-red-300 bg-red-50' :
            contract.dunningStage === 'NOTICE' ? 'border-orange-300 bg-orange-50' :
            'border-yellow-300 bg-yellow-50'
          }`}>
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ระดับติดตามหนี้</div>
            <div className={`text-sm font-bold ${
              contract.dunningStage === 'LEGAL_ACTION' ? 'text-destructive' :
              contract.dunningStage === 'FINAL_WARNING' ? 'text-destructive' :
              contract.dunningStage === 'NOTICE' ? 'text-warning' :
              'text-yellow-600'
            }`}>
              {{ REMINDER: 'แจ้งเตือน', NOTICE: 'แจ้งค้างชำระ', FINAL_WARNING: 'เตือนครั้งสุดท้าย', LEGAL_ACTION: 'ดำเนินคดี' }[contract.dunningStage]}
            </div>
          </div>
        )}
      </div>

      {/* Workflow Actions for Reviewer */}
      {contract.workflowStatus === 'PENDING_REVIEW' && isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">รอการตรวจสอบจากคุณ</h3>
          <div className="space-y-3">
            {/* Document checklist */}
            {docChecklist && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-700">เอกสารที่ต้องมี:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {docChecklist.checklist.map((item) => (
                    <div key={item.type} className={`flex items-center gap-1.5 text-xs ${item.present ? 'text-success' : 'text-destructive'}`}>
                      <span>{item.present ? '✓' : '✗'}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                {!docChecklist.complete && (
                  <p className="text-xs text-destructive font-medium mt-1">กรุณาอัปโหลดเอกสารให้ครบก่อนอนุมัติ</p>
                )}
              </div>
            )}
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
                disabled={approveMutation.isPending || (docChecklist && !docChecklist.complete)}
                title={docChecklist && !docChecklist.complete ? 'เอกสารยังไม่ครบ' : ''}
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
        <div className="bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-destructive">สัญญาถูกปฏิเสธ</h3>
          <div className="text-sm text-destructive mt-1">เหตุผล: {contract.reviewNotes}</div>
          {contract.reviewedBy && <div className="text-xs text-red-500 mt-1">โดย: {contract.reviewedBy.name} | {contract.reviewedAt && new Date(contract.reviewedAt).toLocaleString('th-TH')}</div>}
        </div>
      )}

      {/* Signing guide removed — replaced by workflow stepper above */}

      {/* Pending review & Approved banners removed — replaced by workflow stepper above */}

      {/* Contract Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">ข้อมูลสัญญา</h2>
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
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ราคาขาย</label>
                  <input type="number" value={editForm.sellingPrice} onChange={(e) => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินดาวน์</label>
                  <input type="number" value={editForm.downPayment} onChange={(e) => setEditForm({ ...editForm, downPayment: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนงวด (เดือน)</label>
                  <input type="number" value={editForm.totalMonths} onChange={(e) => setEditForm({ ...editForm, totalMonths: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อัตราดอกเบี้ย (ทศนิยม เช่น 0.08)</label>
                  <input type="number" step="0.01" value={editForm.interestRate} onChange={(e) => setEditForm({ ...editForm, interestRate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันชำระ</label>
                  <select value={editForm.paymentDueDay} onChange={(e) => setEditForm({ ...editForm, paymentDueDay: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                    {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
                      <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน' : `วันที่ ${d}`}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              {/* Preview calculation */}
              {editForm.sellingPrice > 0 && editForm.downPayment >= 0 && editForm.totalMonths > 0 && editForm.downPayment < editForm.sellingPrice && (() => {
                const p = editForm.sellingPrice - editForm.downPayment;
                const commPct = contract.interestConfig ? parseFloat(contract.interestConfig.storeCommissionPct || '0.10') : 0.10;
                const vPct = contract.interestConfig ? parseFloat(contract.interestConfig.vatPct || '0.07') : 0.07;
                const comm = p * commPct;
                const interest = p * editForm.interestRate * editForm.totalMonths;
                const vat = (p + comm + interest) * vPct;
                const total = p + comm + interest + vat;
                const monthly = Math.ceil(total / editForm.totalMonths);
                return (
                  <div className="bg-muted rounded-lg p-3 text-xs space-y-1">
                    <div>ยอดปล่อย: {p.toLocaleString()} ฿</div>
                    <div>ค่าคอมหน้าร้าน ({(commPct * 100).toFixed(0)}%): {comm.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div>ดอกเบี้ยรวม: {interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div>VAT ({(vPct * 100).toFixed(0)}%): {vat.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div className="font-semibold">ค่างวด/เดือน: {monthly.toLocaleString()} ฿</div>
                  </div>
                );
              })()}
              {editForm.totalMonths <= 0 && <div className="text-xs text-destructive">จำนวนงวดต้องมากกว่า 0</div>}
              {editForm.downPayment >= editForm.sellingPrice && editForm.sellingPrice > 0 && <div className="text-xs text-destructive">เงินดาวน์ต้องน้อยกว่าราคาขาย</div>}
              {editForm.sellingPrice <= 0 && <div className="text-xs text-destructive">ราคาขายต้องมากกว่า 0</div>}
              {(editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)) && <div className="text-xs text-destructive">วันชำระต้องอยู่ระหว่าง 1-28 หรือสิ้นเดือน</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
                <button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending || editForm.totalMonths <= 0 || editForm.sellingPrice <= 0 || editForm.downPayment >= editForm.sellingPrice || editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Info label="ประเภทแผน" value="ผ่อนกับ BESTCHOICE" />
              <Info label="ราคาขาย" value={`${parseFloat(contract.sellingPrice).toLocaleString()} ฿`} />
              <Info label="เงินดาวน์" value={`${parseFloat(contract.downPayment).toLocaleString()} ฿`} />
              <Info label="ยอดปล่อย (Loan)" value={`${(parseFloat(contract.sellingPrice) - parseFloat(contract.downPayment)).toLocaleString()} ฿`} />
              <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%${contract.interestConfig ? ` (${contract.interestConfig.name})` : ''}`} />
              <Info label="ดอกเบี้ยรวม" value={`${parseFloat(contract.interestTotal).toLocaleString()} ฿`} />
              <Info label="ยอดจัดไฟแนนซ์" value={`${parseFloat(contract.financedAmount).toLocaleString()} ฿`} />
              <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
              <Info label="วันชำระ" value={contract.paymentDueDay === 31 ? 'สิ้นเดือน' : contract.paymentDueDay ? `ทุกวันที่ ${contract.paymentDueDay}` : 'วันที่ 1'} />
              <Info label="พนักงานขาย" value={contract.salesperson.name} />
              <Info label="สาขา" value={contract.branch.name} />
              <Info label="วันที่สร้าง" value={new Date(contract.createdAt).toLocaleDateString('th-TH')} />
              {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">ข้อมูลลูกค้า</h2>
                {contract.customerSnapshot && (
                  <span className="text-2xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">ณ วันที่สร้างสัญญา</span>
                )}
              </div>
              {canEditMaster && (
                <button onClick={() => setIsEditingCustomer(true)} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                  แก้ไข
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="ชื่อ" value={contract.customerSnapshot?.prefix ? `${contract.customerSnapshot.prefix}${contract.customerSnapshot?.name || contract.customer.name}` : (contract.customerSnapshot?.name || contract.customer.name)} />
              <Info label="ชื่อเล่น" value={contract.customerSnapshot?.nickname || '-'} />
              <Info label="เบอร์โทร" value={contract.customerSnapshot?.phone || contract.customer.phone} />
              <Info label="อาชีพ" value={contract.customerSnapshot?.occupation || '-'} />
              {contract.customerSnapshot?.salary && <Info label="รายได้" value={`${parseFloat(contract.customerSnapshot.salary).toLocaleString()} ฿`} />}
            </div>
            <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary hover:underline">ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)</button>
          </div>

          <div className="rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">ข้อมูลสินค้า</h2>
              {canEditMaster && (
                <button onClick={() => setIsEditingProduct(true)} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                  แก้ไข
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="สินค้า" value={`${contract.product.brand} ${contract.product.model}`} />
              <Info label="ชื่อ" value={contract.product.name} />
              {contract.product.color && <Info label="สี" value={contract.product.color} />}
              {contract.product.storage && <Info label="ความจุ" value={contract.product.storage} />}
              {contract.product.serialNumber && <Info label="S/N" value={contract.product.serialNumber} />}
              {contract.product.imeiSerial && <Info label="IMEI" value={contract.product.imeiSerial} />}
            </div>
            <button onClick={() => navigate(`/products/${contract.product.id}`)} className="mt-3 text-xs text-primary hover:underline">ดูรายละเอียดสินค้า</button>
          </div>

          {/* QR Code Verification */}
          {contract.contractHash && (
            <div className="rounded-lg border p-6">
              <h2 className="text-sm font-semibold text-foreground mb-2">ตรวจสอบสัญญา (QR Verify)</h2>
              <div className="text-xs text-muted-foreground mb-2">Hash: <span className="font-mono">{contract.contractHash?.slice(0, 16)}...</span></div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="text-xs text-success">สัญญาได้รับการยืนยันแล้ว</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                URL: /api/contracts/{id}/verify
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Early Payoff Quote */}
      {payoffQuote && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
        <div className="bg-primary/5 rounded-lg border border-primary/30 p-6 mb-6">
          <h2 className="text-lg font-semibold text-primary mb-3">ประเมินปิดก่อนกำหนด</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><div className="text-xs text-primary">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
            <div><div className="text-xs text-primary">เงินต้นคงเหลือ</div><div className="font-medium">{payoffQuote.remainingPrincipal.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-primary">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{payoffQuote.remainingInterest.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-success">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-success">-{payoffQuote.discount.toLocaleString()} ฿</div></div>
            {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-destructive">ค่าปรับค้างชำระ</div><div className="font-medium text-destructive">{payoffQuote.unpaidLateFees.toLocaleString()} ฿</div></div>}
            <div><div className="text-xs text-primary font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-primary">{payoffQuote.totalPayoff.toLocaleString()} ฿</div></div>
          </div>
        </div>
      )}

      {/* Signing Status + E-Document Downloads */}
      {(contract.signatures.length > 0 || eDocuments.length > 0) && (
        <div className="rounded-lg border p-4 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">สถานะเอกสารและลายเซ็น</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {[
              { type: 'CUSTOMER', label: 'ผู้ซื้อ' },
              { type: 'COMPANY', label: 'ผู้ขาย' },
              { type: 'WITNESS_1', label: 'พยาน 1' },
              { type: 'WITNESS_2', label: 'พยาน 2' },
            ].map(({ type, label }) => {
              const sig = contract.signatures.find(s => (s.signerType === 'STAFF' ? 'COMPANY' : s.signerType) === type);
              return (
                <div key={type} className={`p-2 rounded-lg text-center text-xs ${sig ? 'bg-success/5 dark:bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                  {sig ? '\u2713' : '\u2B1C'} {label}
                  {sig && <div className="text-2xs mt-0.5">{new Date(sig.signedAt).toLocaleDateString('th-TH')}</div>}
                </div>
              );
            })}
          </div>
          {contract.pdpaConsentId && (
            <div className="text-xs text-success mb-3">{'\u2713'} ยินยอม PDPA แล้ว</div>
          )}
          {eDocuments.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-medium">เอกสาร PDF:</div>
              {eDocuments.map(doc => (
                <div key={doc.id} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                  <div className="text-xs">
                    <span className="font-medium">{doc.documentType === 'CONTRACT' ? 'สัญญา' : doc.documentType === 'PDPA_CONSENT' ? 'PDPA' : doc.documentType}</span>
                    <span className="text-muted-foreground ml-2">{new Date(doc.createdAt).toLocaleDateString('th-TH')}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const { data } = await api.get(`/documents/${doc.id}/signed-url`);
                          window.open(data.url, '_blank');
                        } catch {
                          // Fallback: direct download
                          window.open(`/api/documents/${doc.id}/download`, '_blank');
                        }
                      }}
                      className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                      ดาวน์โหลด
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs: Schedule / Documents / Credit Check / Preview */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedule' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ตารางผ่อน ({paidCount}/{contract.totalMonths})
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'preview' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ดูสัญญา
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          เอกสาร ({contract.contractDocuments.length})
        </button>
        <button
          onClick={() => setActiveTab('credit')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'credit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ตรวจเครดิต
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'preview' && (
        <div className="bg-muted rounded-lg border overflow-hidden" style={{ height: '80vh' }}>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12 bg-background">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : preview ? (
            <ContractPreviewFrame html={preview.html} />
          ) : (
            <div className="flex items-center justify-center py-12 bg-background text-muted-foreground">ไม่สามารถโหลดตัวอย่างสัญญาได้</div>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <>
          <PaymentTimeline payments={contract.payments} />
          <DataTable columns={paymentColumns} data={contract.payments} emptyMessage="ยังไม่มีตารางผ่อน" />
        </>
      )}

      {activeTab === 'documents' && (
        <DocumentUpload contractId={contract.id} customerId={contract.customer.id} />
      )}

      {activeTab === 'credit' && (
        <CreditCheckPanel contractId={contract.id} />
      )}

      {/* Product Edit Modal */}
      {isEditingProduct && (
        <ProductEditModal
          product={contract.product}
          onClose={() => setIsEditingProduct(false)}
          onSuccess={invalidateContract}
        />
      )}

      {/* Customer Edit Modal */}
      {isEditingCustomer && (
        <CustomerEditModal
          customerId={contract.customer.id}
          customerSnapshot={contract.customerSnapshot}
          customerBasic={contract.customer}
          onClose={() => setIsEditingCustomer(false)}
          onSuccess={invalidateContract}
        />
      )}


      {/* Early Payoff Modal */}
      {showPayoffModal && payoffQuote && (
        <Modal isOpen title="ปิดสัญญาก่อนกำหนด" onClose={() => setShowPayoffModal(false)}>
          <div className="space-y-4">
            <div className="bg-primary/5 rounded-lg p-4">
              <div className="text-sm">ยอดที่ต้องชำระ</div>
              <div className="text-2xl font-bold text-primary">{payoffQuote.totalPayoff.toLocaleString()} ฿</div>
              <div className="text-xs text-primary mt-1">(รวมส่วนลดดอกเบี้ย 50% แล้ว)</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วิธีชำระ</label>
              <select value={payoffMethod} onChange={(e) => setPayoffMethod(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPayoffModal(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={() => earlyPayoffMutation.mutate()} disabled={earlyPayoffMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {earlyPayoffMutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Submit Review Confirm Modal */}
      {showSubmitConfirm && (
        <Modal isOpen title="ยืนยันส่งตรวจสอบ" onClose={() => setShowSubmitConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              เมื่อส่งตรวจสอบแล้ว จะไม่สามารถแก้ไขสัญญาได้จนกว่าจะถูกปฏิเสธ ยืนยันหรือไม่?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowSubmitConfirm(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={() => { setShowSubmitConfirm(false); submitReviewMutation.mutate(); }}
                disabled={submitReviewMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ยืนยันส่งตรวจสอบ'}
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
              <label className="block text-sm font-medium text-foreground mb-1">เหตุผลที่ปฏิเสธ *</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="ระบุเหตุผลที่ปฏิเสธสัญญา..."
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowRejectModal(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
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

      {customerLink && (
        <Modal isOpen title="ลิงก์สำหรับลูกค้า" onClose={() => setCustomerLink(null)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">ลิงก์นี้ให้ลูกค้าเข้าดูสัญญา ตารางผ่อน และใบเสร็จได้ (มีอายุ 48 ชม.)</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customerLink}
                readOnly
                className="flex-1 px-3 py-2 border rounded-lg text-sm bg-muted"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(customerLink); toast.success('คัดลอกลิงก์แล้ว'); }}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                คัดลอก
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.message}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-muted-foreground mb-0.5">{label}</div><div className="text-sm text-foreground">{value || '-'}</div></div>;
}

/** Renders contract HTML in a sandboxed iframe */
function ContractPreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="contract-preview"
      className="w-full h-full border-0"
      sandbox="allow-same-origin allow-popups allow-modals allow-scripts"
    />
  );
}
