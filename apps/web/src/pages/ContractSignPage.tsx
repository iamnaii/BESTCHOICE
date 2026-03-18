import { useParams, useNavigate } from 'react-router-dom';
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
  const { data: systemSettings = [] } = useQuery<{ key: string; value: string }[]>({
    queryKey: ['settings'],
    queryFn: async () => { const { data } = await api.get('/settings'); return data; },
  });
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
      <div className="text-center py-12">
        <p className="text-muted-foreground">ไม่พบสัญญา</p>
        <button onClick={() => navigate('/contracts')} className="mt-4 text-primary hover:underline text-sm">
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
            <button onClick={() => navigate(`/contracts/${id}`)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">
              กลับ
            </button>
          }
        />
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
          <div className="text-sm font-medium text-amber-800">ไม่สามารถลงนามได้</div>
          <div className="text-xs text-amber-600 mt-1">สัญญาไม่อยู่ในสถานะร่าง (สถานะปัจจุบัน: {contract.status})</div>
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
          <button onClick={() => navigate(`/contracts/${id}`)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">
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
