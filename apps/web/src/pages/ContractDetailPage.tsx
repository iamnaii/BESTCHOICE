import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/ui/PageHeader';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import QueryBoundary from '@/components/QueryBoundary';
import Modal from '@/components/ui/Modal';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import DocumentUpload from '@/components/contract/DocumentUpload';
import CreditCheckPanel from '@/components/contract/CreditCheckPanel';
import ProductEditModal from '@/components/contract/ProductEditModal';
import CustomerEditModal from '@/components/contract/CustomerEditModal';
import ContractPaymentSchedule from '@/components/contract/ContractPaymentSchedule';
import ContractDocuments from '@/components/contract/ContractDocuments';
import { ContractEarlyPayoffQuote, EarlyPayoffOverlay } from '@/components/contract/ContractEarlyPayoff';
import { toast } from 'sonner';
import { useState, useRef, useEffect } from 'react';
import { Copy, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DetailPageSkeleton } from '@/components/ui/page-skeletons';
import { formatNumber, formatDateMedium } from '@/utils/formatters';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, contractStatusMap } from '@/lib/status-badges';
import MdmDeviceWidget from '@/components/mdm/MdmDeviceWidget';

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
  contractDocuments: { id: string; documentType: string; fileName: string; fileUrl: string; createdAt: string }[];
  creditCheck: { id: string; status: string; aiScore: number | null; aiSummary: string | null } | null;
}

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
}



export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { copy: copyToClipboard } = useCopyToClipboard();
  const [showPayoffModal, setShowPayoffModal] = useState(false);
  const [customerLink, setCustomerLink] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'schedule' | 'documents' | 'credit' | 'preview'>('schedule');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ sellingPrice: 0, downPayment: 0, totalMonths: 0, interestRate: 0, paymentDueDay: 1, notes: '' });

  const {
    data: contract,
    isLoading,
    isError: contractError,
    error: contractErrorDetail,
    refetch: refetchContract,
  } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });
  useDocumentTitle(contract?.contractNumber);

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
      } catch (err: unknown) {
        const validationErr = err as { isValidation?: boolean };
        if (validationErr.isValidation) throw err;
        // If validate endpoint fails, proceed anyway (endpoint might not exist)
      }
      const { data } = await api.post(`/contracts/${id}/submit-review`);
      return data;
    },
    onSuccess: () => { toast.success('ส่งตรวจสอบแล้ว'); invalidateContract(); },
    onError: (err: unknown) => {
      const validationErr = err as { isValidation?: boolean; errors?: string[] };
      if (validationErr.isValidation) {
        toast.error(`สัญญาไม่ครบถ้วน: ${validationErr.errors?.join(', ')}`);
      } else {
        toast.error(getErrorMessage(err));
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/approve`, { reviewNotes: approveNotes || undefined }); return data; },
    onSuccess: () => { toast.success('อนุมัติสัญญาแล้ว'); invalidateContract(); setApproveNotes(''); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/reject`, { reviewNotes: rejectNotes }); return data; },
    onSuccess: () => { toast.success('ปฏิเสธสัญญาแล้ว'); invalidateContract(); setShowRejectModal(false); setRejectNotes(''); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); invalidateContract(); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

const deleteMutation = useMutation({
    mutationFn: async () => { const { data } = await api.delete(`/contracts/${id}`); return data; },
    onSuccess: () => { toast.success('ลบสัญญาแล้ว'); navigate('/contracts'); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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

  if (contractError) {
    return (
      <QueryBoundary
        isLoading={false}
        isError={true}
        error={contractErrorDetail}
        onRetry={refetchContract}
        errorTitle="ไม่สามารถโหลดข้อมูลสัญญาได้"
      >
        <div />
      </QueryBoundary>
    );
  }

  if (isLoading || !contract) {
    return <DetailPageSkeleton />;
  }

  const statusCfg = getStatusBadgeProps(contract.status, contractStatusMap);
  const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
  const totalOutstanding = contract.payments
    .filter((p) => p.status !== 'PAID')
    .reduce((sum, p) => sum + parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid || '0'), 0);
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

  return (
    <div>
      <PageHeader
        title={contract.contractNumber}
        subtitle="รายละเอียดสัญญาผ่อนชำระ"
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink asChild><Link to="/contracts">สัญญา</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{contract.contractNumber}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 shadow-sm">
              ลงนาม/เอกสาร
            </button>
            <button
              onClick={async () => {
                try {
                  toast.loading('กำลังสร้าง PDF...', { id: 'pdf-gen' });
                  const res = await api.get(`/contracts/${id}/download-pdf`, { responseType: 'blob' });
                  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${contract.contractNumber}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                  toast.success('ดาวน์โหลด PDF สำเร็จ', { id: 'pdf-gen' });
                } catch (err) {
                  toast.error(getErrorMessage(err) || 'ไม่สามารถสร้าง PDF ได้', { id: 'pdf-gen' });
                }
              }}
              className="px-4 py-2 text-sm border border-input bg-background text-foreground rounded-lg hover:bg-accent hover:text-accent-foreground shadow-sm"
            >
              ดาวน์โหลด PDF
            </button>

            {/* Workflow buttons */}
            {contract.workflowStatus === 'APPROVED' && contract.status === 'DRAFT' && (
              <button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending || !allSigned} title={!allSigned ? 'ต้องลงนามครบทั้งลูกค้าและพนักงานก่อน' : ''} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}

            {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-warning text-warning-foreground rounded-lg hover:bg-warning/90 shadow-sm">
                ปิดก่อนกำหนด
              </button>
            )}
            {['ACTIVE', 'OVERDUE', 'COMPLETED'].includes(contract.status) && (
              <button
                onClick={() => customerLinkMutation.mutate()}
                disabled={customerLinkMutation.isPending}
                className="px-4 py-2 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90 disabled:opacity-50 shadow-sm"
              >
                {customerLinkMutation.isPending ? 'กำลังสร้าง...' : 'ส่งลิงก์ลูกค้า'}
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirmDialog({ open: true, title: 'ลบสัญญา', message: 'ยืนยันลบสัญญานี้?', variant: 'destructive', action: () => deleteMutation.mutate() })}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบสัญญา'}
              </button>
            )}
            <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm bg-muted text-foreground rounded-lg hover:bg-muted/80 shadow-sm">
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
          <div className="rounded-xl border border-border/50 bg-card p-5 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step.done ? 'bg-success text-success-foreground' : i === currentStep ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1' : 'bg-muted text-muted-foreground'}`}>
                      {step.done ? '✓' : i + 1}
                    </div>
                    <span className={`text-2xs md:text-xs text-center leading-tight ${step.done ? 'text-success font-medium' : i === currentStep ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 mt-[-16px] ${step.done ? 'bg-success' : 'bg-muted'}`} />
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
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะสัญญา</div>
            <Badge variant={statusCfg.variant} appearance={statusCfg.appearance} size="sm">{statusCfg.label}</Badge>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Workflow</div>
            <WorkflowStatusBadge status={contract.workflowStatus} />
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่างวด/เดือน</div>
            <div className="text-xl font-bold text-primary tabular-nums font-mono">{formatNumber(contract.monthlyPayment)} บาท</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-success" />
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชำระแล้ว</div>
            <div className="text-xl font-bold text-success tabular-nums">{paidCount}/{contract.totalMonths} งวด</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดผ่อนรวม</div>
            <div className="text-xl font-bold tabular-nums font-mono">{formatNumber(contract.financedAmount)} บาท</div>
          </CardContent>
        </Card>
        {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && totalOutstanding > 0 && (
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-destructive" />
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดค้างรวม</div>
              <div className="text-xl font-bold text-destructive tabular-nums font-mono">{formatNumber(totalOutstanding)} บาท</div>
            </CardContent>
          </Card>
        )}
        {contract.creditBalance && parseFloat(contract.creditBalance) > 0 && (
          <div className="rounded-lg border border-success/20 bg-success/5 dark:bg-success/10 p-4">
            <div className="text-xs text-success mb-1">ยอดเครดิตคงเหลือ</div>
            <div className="text-xl font-bold text-success">{formatNumber(contract.creditBalance)} บาท</div>
            {['ACTIVE', 'OVERDUE'].includes(contract.status) && (
              <button
                onClick={() => setConfirmDialog({
                  open: true,
                  title: 'ใช้เครดิตชำระ',
                  message: `ใช้เครดิต ${formatNumber(contract.creditBalance!)} บาท ชำระงวดถัดไป?`,
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
                className="mt-2 px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                ใช้เครดิตชำระ
              </button>
            )}
          </div>
        )}
        {contract.dunningStage && contract.dunningStage !== 'NONE' && (
          <div className={`rounded-xl border p-4 ${
            contract.dunningStage === 'LEGAL_ACTION' ? 'border-destructive/30 bg-destructive/5 dark:bg-destructive/10' :
            contract.dunningStage === 'FINAL_WARNING' ? 'border-destructive/20 bg-destructive/5 dark:bg-destructive/10' :
            contract.dunningStage === 'NOTICE' ? 'border-warning/30 bg-warning/5 dark:bg-warning/10' :
            'border-warning/20 bg-warning/5 dark:bg-warning/10'
          }`}>
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ระดับติดตามหนี้</div>
            <div className={`text-sm font-bold ${
              contract.dunningStage === 'LEGAL_ACTION' ? 'text-destructive' :
              contract.dunningStage === 'FINAL_WARNING' ? 'text-destructive' :
              contract.dunningStage === 'NOTICE' ? 'text-warning' :
              'text-warning/80'
            }`}>
              {{ REMINDER: 'แจ้งเตือน', NOTICE: 'แจ้งค้างชำระ', FINAL_WARNING: 'เตือนครั้งสุดท้าย', LEGAL_ACTION: 'ดำเนินคดี' }[contract.dunningStage]}
            </div>
          </div>
        )}
      </div>

      {/* Workflow Actions for Reviewer */}
      {contract.workflowStatus === 'PENDING_REVIEW' && isReviewer && (() => {
        const missingItems = docChecklist?.checklist.filter((i) => !i.present) ?? [];
        const presentItems = docChecklist?.checklist.filter((i) => i.present) ?? [];
        const total = docChecklist?.checklist.length ?? 0;
        const completeCount = presentItems.length;
        return (
          <div className="bg-card border border-border rounded-xl shadow-sm p-6 mb-6 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-warning" />

            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-warning/15 dark:bg-warning/25 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">รอการตรวจสอบจากคุณ</h3>
              </div>
              {docChecklist && (
                <span
                  className={`text-sm font-semibold px-3 py-1 rounded-full ${
                    docChecklist.complete
                      ? 'bg-success/15 text-success dark:bg-success/25'
                      : 'bg-destructive/15 text-destructive dark:bg-destructive/25'
                  }`}
                >
                  เอกสาร {completeCount}/{total}
                </span>
              )}
            </div>

            {docChecklist && (
              <div className="space-y-4 mb-5">
                {/* Missing items — highlighted red box */}
                {missingItems.length > 0 && (
                  <div className="bg-destructive/10 dark:bg-destructive/20 border-2 border-destructive/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                      <p className="text-sm font-bold text-destructive">
                        ยังขาดเอกสาร {missingItems.length} รายการ
                      </p>
                    </div>
                    <ul className="space-y-2">
                      {missingItems.map((item) => (
                        <li key={item.type} className="flex items-start gap-2 text-sm text-destructive font-medium">
                          <span className="text-destructive mt-0.5">•</span>
                          <span>{item.label}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-destructive/90 dark:text-destructive mt-3 pt-3 border-t border-destructive/30">
                      กรุณาอัปโหลดเอกสารให้ครบก่อนจึงจะสามารถอนุมัติสัญญาได้
                    </p>
                  </div>
                )}

                {/* Present items — clean list */}
                {presentItems.length > 0 && (
                  <details open={missingItems.length === 0} className="group">
                    <summary className="text-sm font-medium text-muted-foreground mb-2 cursor-pointer hover:text-foreground select-none list-none flex items-center gap-1.5">
                      <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                      เอกสารที่พร้อมแล้ว ({presentItems.length})
                    </summary>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-2 pl-5">
                      {presentItems.map((item) => (
                        <li key={item.type} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                          <span className="text-foreground">{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <div className="mb-5">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                หมายเหตุ <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>
              </label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="เช่น ตรวจสอบเอกสารครบแล้ว..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || (docChecklist && !docChecklist.complete)}
                title={docChecklist && !docChecklist.complete ? 'เอกสารยังไม่ครบ' : ''}
                className="px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติสัญญา'}
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                className="px-6 py-2.5 text-sm font-semibold bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        );
      })()}

      {/* Rejection notes */}
      {contract.workflowStatus === 'REJECTED' && contract.reviewNotes && (
        <div className="bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-destructive">สัญญาถูกปฏิเสธ</h3>
          <div className="text-sm text-destructive mt-1">เหตุผล: {contract.reviewNotes}</div>
          {contract.reviewedBy && <div className="text-xs text-muted-foreground mt-1">โดย: {contract.reviewedBy.name} | {contract.reviewedAt && formatDateMedium(contract.reviewedAt)}</div>}
        </div>
      )}

      {/* Signing guide removed — replaced by workflow stepper above */}

      {/* Pending review & Approved banners removed — replaced by workflow stepper above */}

      {/* Contract Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-7.5 mb-6">
        <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">ข้อมูลสัญญา</h2>
              <button
                onClick={() => { copyToClipboard(contract.contractNumber); toast.success('คัดลอกเลขที่สัญญาแล้ว'); }}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="คัดลอกเลขที่สัญญา"
                title={contract.contractNumber}
              >
                <Copy className="size-3.5" />
              </button>
            </div>
            {canEdit && !isEditing && (
              <button onClick={startEditing} className="px-3 py-1 text-xs bg-warning/10 text-warning rounded-lg hover:bg-warning/20">
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
                    <div>ยอดปล่อย: {formatNumber(p)} บาท</div>
                    <div>ค่าคอมหน้าร้าน ({(commPct * 100).toFixed(0)}%): {formatNumber(Math.round(comm))} บาท</div>
                    <div>ดอกเบี้ยรวม: {formatNumber(Math.round(interest))} บาท</div>
                    <div>VAT ({(vPct * 100).toFixed(0)}%): {formatNumber(Math.round(vat))} บาท</div>
                    <div className="font-semibold">ค่างวด/เดือน: {formatNumber(monthly)} บาท</div>
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
              <Info label="ราคาขาย" value={`${formatNumber(contract.sellingPrice)} บาท`} />
              <Info label="เงินดาวน์" value={`${formatNumber(contract.downPayment)} บาท`} />
              <Info label="ยอดปล่อย (Loan)" value={`${formatNumber(parseFloat(contract.sellingPrice) - parseFloat(contract.downPayment))} บาท`} />
              <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%${contract.interestConfig ? ` (${contract.interestConfig.name})` : ''}`} />
              <Info label="ดอกเบี้ยรวม" value={`${formatNumber(contract.interestTotal)} บาท`} />
              <Info label="ยอดจัดไฟแนนซ์" value={`${formatNumber(contract.financedAmount)} บาท`} />
              <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
              <Info label="วันชำระ" value={contract.paymentDueDay === 31 ? 'สิ้นเดือน' : contract.paymentDueDay ? `ทุกวันที่ ${contract.paymentDueDay}` : 'วันที่ 1'} />
              <Info label="พนักงานขาย" value={contract.salesperson.name} />
              <Info label="สาขา" value={contract.branch.name} />
              <Info label="วันที่สร้าง" value={formatDateMedium(contract.createdAt)} />
              {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
            </div>
          )}
        </div>

        <div className="space-y-5 lg:space-y-7.5">
          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">ข้อมูลลูกค้า</h2>
                {contract.customerSnapshot && (
                  <span className="text-2xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">ณ วันที่สร้างสัญญา</span>
                )}
              </div>
              {canEditMaster && (
                <button onClick={() => setIsEditingCustomer(true)} className="px-3 py-1 text-xs bg-warning/10 text-warning rounded-lg hover:bg-warning/20">
                  แก้ไข
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="ชื่อ" value={contract.customerSnapshot?.prefix ? `${contract.customerSnapshot.prefix}${contract.customerSnapshot?.name || contract.customer.name}` : (contract.customerSnapshot?.name || contract.customer.name)} />
              <Info label="ชื่อเล่น" value={contract.customerSnapshot?.nickname || '-'} />
              <Info label="เบอร์โทร" value={contract.customerSnapshot?.phone || contract.customer.phone} />
              <Info label="อาชีพ" value={contract.customerSnapshot?.occupation || '-'} />
              {contract.customerSnapshot?.salary && <Info label="รายได้" value={`${formatNumber(contract.customerSnapshot.salary)} บาท`} />}
            </div>
            <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary hover:underline">ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)</button>
          </div>

          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">ข้อมูลสินค้า</h2>
              {canEditMaster && (
                <button onClick={() => setIsEditingProduct(true)} className="px-3 py-1 text-xs bg-warning/10 text-warning rounded-lg hover:bg-warning/20">
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

          {/* MDM Device Widget */}
          {contract.product.imeiSerial && (
            <MdmDeviceWidget imei={contract.product.imeiSerial} />
          )}

          {/* QR Code Verification */}
          {contract.contractHash && (
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground mb-2">ตรวจสอบสัญญา (QR Verify)</h2>
              <div className="text-xs text-muted-foreground mb-2">Hash: <span className="font-mono">{contract.contractHash?.slice(0, 16)}...</span></div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 bg-success rounded-full"></span>
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
      {payoffQuote && (
        <ContractEarlyPayoffQuote payoffQuote={payoffQuote} contractStatus={contract.status} />
      )}

      {/* Signing Status + E-Document Downloads */}
      <ContractDocuments
        signatures={contract.signatures}
        eDocuments={eDocuments}
        pdpaConsentId={contract.pdpaConsentId}
      />

      {/* Tabs: Schedule / Documents / Credit Check / Preview */}
      <div className="flex gap-1 mb-4 border-b border-border/60">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedule' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ตารางผ่อน
          <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-2xs bg-muted text-muted-foreground">{paidCount}/{contract.totalMonths}</span>
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'preview' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ดูสัญญา
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          เอกสาร
          {contract.contractDocuments.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-2xs bg-primary/10 text-primary">{contract.contractDocuments.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('credit')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'credit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ตรวจเครดิต
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'preview' && (
        <div className="bg-muted rounded-lg border overflow-hidden h-[80vh]">
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
        <ContractPaymentSchedule payments={contract.payments} />
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


      {/* Early Payoff Overlay */}
      {showPayoffModal && contract && (
        <EarlyPayoffOverlay
          contractId={contract.id}
          contractNumber={contract.contractNumber}
          customerName={contract.customer?.name || '-'}
          productName={contract.product?.name}
          branchName={contract.branch?.name}
          onClose={() => setShowPayoffModal(false)}
          onSuccess={invalidateContract}
        />
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
                className="flex-1 px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
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
                onClick={() => { copyToClipboard(customerLink); toast.success('คัดลอกลิงก์แล้ว'); }}
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
    // Strip Google Fonts — force local TH Sarabun PSK only
    let cleaned = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, '');
    cleaned = cleaned.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, '');
    // Inject font-face declarations to ensure TH Sarabun PSK loads
    const fontFix = `<style>
      @font-face { font-family:'TH Sarabun PSK'; src:url('/fonts/THSarabunPSK-Regular.ttf') format('truetype'); font-weight:400; font-display:swap; }
      @font-face { font-family:'TH Sarabun PSK'; src:url('/fonts/THSarabunPSK-Bold.ttf') format('truetype'); font-weight:700; font-display:swap; }
    </style>`;
    const injected = cleaned.includes('</head>')
      ? cleaned.replace('</head>', `${fontFix}</head>`)
      : `${fontFix}${cleaned}`;
    doc.open();
    doc.write(injected);
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
