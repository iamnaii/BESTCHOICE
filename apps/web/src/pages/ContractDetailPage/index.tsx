/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import DocumentUpload from '@/components/contract/DocumentUpload';
import CreditCheckPanel from '@/components/contract/CreditCheckPanel';
import ProductEditModal from '@/components/contract/ProductEditModal';
import CustomerEditModal from '@/components/contract/CustomerEditModal';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { statusLabels } from './types';
import { useContractDetail } from './useContractDetail';
import { useContractActions } from './useContractActions';
import ContractInfoSection from './ContractInfoSection';
import PaymentScheduleTab from './PaymentScheduleTab';
import SignaturesSection from './SignaturesSection';

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

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title?: string; message: string; variant?: 'default' | 'destructive'; action: () => void }>({ open: false, message: '', action: () => {} });

  const { contract, isLoading, payoffQuote, eDocuments, docChecklist } = useContractDetail(id);
  const actions = useContractActions(id);

  const { data: preview, isLoading: previewLoading } = useQuery<{ html: string }>({
    queryKey: ['contract-preview', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/preview`); return data; },
    enabled: activeTab === 'preview',
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
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
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
                  const iframe = document.querySelector('iframe[title="contract-preview"]') as HTMLIFrameElement;
                  if (!iframe || !document.body.contains(iframe)) return;
                  if (iframe.contentWindow && iframe.contentDocument?.body?.innerHTML) {
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

            {contract.workflowStatus === 'APPROVED' && contract.status === 'DRAFT' && (
              <button onClick={() => actions.activateMutation.mutate()} disabled={actions.activateMutation.isPending || !allSigned} title={!allSigned ? 'ต้องลงนามครบทั้งลูกค้าและพนักงานก่อน' : ''} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {actions.activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}

            {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                ปิดก่อนกำหนด
              </button>
            )}
            {['ACTIVE', 'OVERDUE', 'COMPLETED'].includes(contract.status) && (
              <button
                onClick={() => actions.customerLinkMutation.mutate(undefined, {
                  onSuccess: (data: { url: string; token: string; expiresAt: string }) => {
                    const link = `${window.location.origin}/customer-access/${data.token}`;
                    setCustomerLink(link);
                  },
                })}
                disabled={actions.customerLinkMutation.isPending}
                className="px-4 py-2 text-sm border border-primary text-primary rounded-lg hover:bg-primary/10 disabled:opacity-50"
              >
                {actions.customerLinkMutation.isPending ? 'กำลังสร้าง...' : 'ส่งลิงก์ลูกค้า'}
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirmDialog({ open: true, title: 'ลบสัญญา', message: 'ยืนยันลบสัญญานี้?', variant: 'destructive', action: () => actions.deleteMutation.mutate() })}
                disabled={actions.deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actions.deleteMutation.isPending ? 'กำลังลบ...' : 'ลบสัญญา'}
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
            action: allSigned ? () => actions.activateMutation.mutate() : undefined,
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
                    <span className={`text-2xs md:text-xs text-center leading-tight ${step.done ? 'text-green-700 font-medium' : i === currentStep ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
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
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground mb-1">สถานะสัญญา</div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground mb-1">Workflow</div>
          <WorkflowStatusBadge status={contract.workflowStatus} />
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground mb-1">ค่างวด/เดือน</div>
          <div className="text-xl font-bold text-primary">{parseFloat(contract.monthlyPayment).toLocaleString()} ฿</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground mb-1">ชำระแล้ว</div>
          <div className="text-xl font-bold text-green-600">{paidCount}/{contract.totalMonths} งวด</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground mb-1">ยอดผ่อนรวม</div>
          <div className="text-xl font-bold">{parseFloat(contract.financedAmount).toLocaleString()} ฿</div>
        </div>
        {contract.creditBalance && parseFloat(contract.creditBalance) > 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="text-xs text-green-700 mb-1">ยอดเครดิตคงเหลือ</div>
            <div className="text-xl font-bold text-green-600">{parseFloat(contract.creditBalance).toLocaleString()} ฿</div>
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
                      actions.invalidateContract();
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
            <div className="text-xs text-muted-foreground mb-1">ระดับติดตามหนี้</div>
            <div className={`text-sm font-bold ${
              contract.dunningStage === 'LEGAL_ACTION' ? 'text-red-700' :
              contract.dunningStage === 'FINAL_WARNING' ? 'text-red-600' :
              contract.dunningStage === 'NOTICE' ? 'text-orange-600' :
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
            {docChecklist && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-700">เอกสารที่ต้องมี:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {docChecklist.checklist.map((item) => (
                    <div key={item.type} className={`flex items-center gap-1.5 text-xs ${item.present ? 'text-green-700' : 'text-red-600'}`}>
                      <span>{item.present ? '✓' : '✗'}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                {!docChecklist.complete && (
                  <p className="text-xs text-red-600 font-medium mt-1">กรุณาอัปโหลดเอกสารให้ครบก่อนอนุมัติ</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-xs text-amber-700 mb-1">หมายเหตุ (ไม่บังคับ)</label>
              <input type="text" value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} placeholder="หมายเหตุการอนุมัติ..." className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => actions.approveMutation.mutate(approveNotes, { onSuccess: () => setApproveNotes('') })}
                disabled={actions.approveMutation.isPending || (docChecklist && !docChecklist.complete)}
                title={docChecklist && !docChecklist.complete ? 'เอกสารยังไม่ครบ' : ''}
                className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {actions.approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติสัญญา'}
              </button>
              <button onClick={() => setShowRejectModal(true)} className="px-6 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
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

      {/* Contract Info (extracted) */}
      <ContractInfoSection
        contract={contract}
        canEdit={!!canEdit}
        canEditMaster={!!canEditMaster}
        isEditing={isEditing}
        editForm={editForm}
        setEditForm={setEditForm}
        onStartEditing={startEditing}
        onCancelEditing={() => setIsEditing(false)}
        onSave={() => actions.updateMutation.mutate(editForm, { onSuccess: () => setIsEditing(false) })}
        isSaving={actions.updateMutation.isPending}
        onEditProduct={() => setIsEditingProduct(true)}
        onEditCustomer={() => setIsEditingCustomer(true)}
      />

      {/* Early Payoff Quote */}
      {payoffQuote && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
        <div className="bg-primary/5 rounded-lg border border-primary/30 p-6 mb-6">
          <h2 className="text-lg font-semibold text-primary mb-3">ประเมินปิดก่อนกำหนด</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><div className="text-xs text-primary">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
            <div><div className="text-xs text-primary">เงินต้นคงเหลือ</div><div className="font-medium">{payoffQuote.remainingPrincipal.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-primary">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{payoffQuote.remainingInterest.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-green-600">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-green-700">-{payoffQuote.discount.toLocaleString()} ฿</div></div>
            {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-red-600">ค่าปรับค้างชำระ</div><div className="font-medium text-red-700">{payoffQuote.unpaidLateFees.toLocaleString()} ฿</div></div>}
            <div><div className="text-xs text-primary font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-primary">{payoffQuote.totalPayoff.toLocaleString()} ฿</div></div>
          </div>
        </div>
      )}

      {/* Signatures & Documents Section (extracted) */}
      <SignaturesSection contract={contract} eDocuments={eDocuments} />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {[
          { key: 'schedule' as const, label: `ตารางผ่อน (${paidCount}/${contract.totalMonths})` },
          { key: 'preview' as const, label: 'ดูสัญญา' },
          { key: 'documents' as const, label: `เอกสาร (${contract.contractDocuments.length})` },
          { key: 'credit' as const, label: 'ตรวจเครดิต' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'preview' && (
        <div className="bg-muted rounded-lg border overflow-hidden" style={{ height: '80vh' }}>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12 bg-background"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : preview ? (
            <ContractPreviewFrame html={preview.html} />
          ) : (
            <div className="flex items-center justify-center py-12 bg-background text-muted-foreground">ไม่สามารถโหลดตัวอย่างสัญญาได้</div>
          )}
        </div>
      )}
      {activeTab === 'schedule' && <PaymentScheduleTab payments={contract.payments} />}
      {activeTab === 'documents' && <DocumentUpload contractId={contract.id} customerId={contract.customer.id} />}
      {activeTab === 'credit' && <CreditCheckPanel contractId={contract.id} />}

      {/* Product Edit Modal */}
      {isEditingProduct && (
        <ProductEditModal product={contract.product} onClose={() => setIsEditingProduct(false)} onSuccess={actions.invalidateContract} />
      )}

      {/* Customer Edit Modal */}
      {isEditingCustomer && (
        <CustomerEditModal customerId={contract.customer.id} customerSnapshot={contract.customerSnapshot} customerBasic={contract.customer} onClose={() => setIsEditingCustomer(false)} onSuccess={actions.invalidateContract} />
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
              <button onClick={() => actions.earlyPayoffMutation.mutate(payoffMethod, { onSuccess: () => setShowPayoffModal(false) })} disabled={actions.earlyPayoffMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {actions.earlyPayoffMutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Submit Review Confirm Modal */}
      {showSubmitConfirm && (
        <Modal isOpen title="ยืนยันส่งตรวจสอบ" onClose={() => setShowSubmitConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">เมื่อส่งตรวจสอบแล้ว จะไม่สามารถแก้ไขสัญญาได้จนกว่าจะถูกปฏิเสธ ยืนยันหรือไม่?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowSubmitConfirm(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={() => { setShowSubmitConfirm(false); actions.submitReviewMutation.mutate(); }} disabled={actions.submitReviewMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {actions.submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ยืนยันส่งตรวจสอบ'}
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
              <textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} placeholder="ระบุเหตุผลที่ปฏิเสธสัญญา..." className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowRejectModal(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={() => actions.rejectMutation.mutate(rejectNotes, { onSuccess: () => { setShowRejectModal(false); setRejectNotes(''); } })}
                disabled={!rejectNotes.trim() || actions.rejectMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actions.rejectMutation.isPending ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
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
              <input type="text" value={customerLink} readOnly className="flex-1 px-3 py-2 border rounded-lg text-sm bg-muted" />
              <button onClick={() => { navigator.clipboard.writeText(customerLink); toast.success('คัดลอกลิงก์แล้ว'); }} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
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
