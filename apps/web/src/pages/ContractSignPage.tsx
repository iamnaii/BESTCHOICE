import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import SigningWizard from '@/components/signing/SigningWizard';

interface ContractDetail {
  id: string;
  status: string;
  workflowStatus: string;
  contractNumber: string;
  pdpaConsentId: string | null;
  customer?: {
    id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    birthDate?: string;
    references?: { prefix?: string; firstName?: string; lastName?: string; phone?: string; relationship?: string }[];
  };
  product?: {
    name?: string;
  };
  totalMonths?: number;
  monthlyPayment?: number;
  creditBalance?: string | null;
  dunningStage?: string | null;
}

export default function ContractSignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: preview } = useQuery<{ html: string }>({
    queryKey: ['contract-preview', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/preview`); return data; },
  });

  // Get lessor (company) signature from system settings
  const { data: rawSettings } = useQuery<{ key: string; value: string }[]>({
    queryKey: ['settings'],
    queryFn: async () => { const { data } = await api.get('/settings'); return data; },
  });
  const systemSettings = Array.isArray(rawSettings) ? rawSettings : [];
  const lessorSignatureImage = systemSettings.find(s => s.key === 'lessor_signature_image')?.value || '';
  const lessorSignerName = systemSettings.find(s => s.key === 'lessor_signer_name')?.value || '';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="text-center py-16">
        <div className="size-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <svg className="size-7 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M4.5 12a7.5 7.5 0 1015 0 7.5 7.5 0 00-15 0z" />
          </svg>
        </div>
        <p className="text-muted-foreground font-medium">ไม่พบสัญญา</p>
        <button onClick={() => navigate('/contracts')} className="mt-4 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
          กลับหน้ารายการสัญญา
        </button>
      </div>
    );
  }

  // Contract not in DRAFT status
  if (contract.status !== 'DRAFT') {
    return (
      <div>
        <PageHeader
          title="ลงนามสัญญา"
          subtitle={contract.contractNumber}
          action={
            <button onClick={() => navigate(`/contracts/${id}`)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg hover:bg-muted transition-colors">
              กลับ
            </button>
          }
        />
        <div className="bg-warning/10 border border-warning/20 rounded-xl p-5 mt-4 flex items-start gap-3">
          <div className="size-8 rounded-full bg-warning/20 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="size-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-warning">ไม่สามารถลงนามได้</div>
            <div className="text-xs text-warning/80 mt-1">สัญญาไม่อยู่ในสถานะร่าง (สถานะปัจจุบัน: {contract.status})</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="ลงนามสัญญา"
        subtitle={`${contract.contractNumber} — ขั้นตอนเซ็นสัญญาดิจิทัล`}
        action={
          <button onClick={() => navigate(`/contracts/${id}`)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg hover:bg-muted transition-colors">
            กลับ
          </button>
        }
      />
      <SigningWizard
        contract={contract}
        previewHtml={preview?.html || null}
        lessorSignatureImage={lessorSignatureImage}
        lessorSignerName={lessorSignerName}
      />
    </div>
  );
}
