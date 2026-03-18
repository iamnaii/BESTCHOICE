import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import SignaturePadFull from './SignaturePadFull';

type SignerType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';

const SIGNER_LABELS: Record<SignerType, string> = {
  CUSTOMER: 'ผู้ซื้อ (ผู้เช่าซื้อ)',
  COMPANY: 'ผู้ขาย (ผู้ให้เช่าซื้อ)',
  WITNESS_1: 'พยาน 1',
  WITNESS_2: 'พยาน 2',
  GUARDIAN: 'ผู้ปกครอง',
};

interface Signature {
  id: string;
  signerType: string;
  signerName?: string;
  signatureImage: string;
  signedAt: string;
}

interface StepSignatureProps {
  contractId: string;
  requiredSigners: SignerType[];
  lessorSignatureImage: string;
  lessorSignerName: string;
  onAllSigned: () => void;
  onBack: () => void;
}

function normalizeSignerType(type: string): string {
  return type === 'STAFF' ? 'COMPANY' : type;
}

export default function StepSignature({
  contractId,
  requiredSigners,
  lessorSignatureImage,
  lessorSignerName,
  onAllSigned,
  onBack,
}: StepSignatureProps) {
  const queryClient = useQueryClient();
  const [signerName, setSignerName] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [autoSignedCompany, setAutoSignedCompany] = useState(false);

  // Existing signatures
  const { data: signatures = [] } = useQuery<Signature[]>({
    queryKey: ['contract-signatures', contractId],
    queryFn: async () => { const { data } = await api.get(`/contracts/${contractId}/signatures`); return data; },
  });

  // Saved staff signature
  const { data: savedSigData } = useQuery<{ signatureImage: string | null }>({
    queryKey: ['saved-signature'],
    queryFn: async () => { const { data } = await api.get('/users/me/signature'); return data; },
  });
  const savedSignature = savedSigData?.signatureImage || null;

  const signedTypes = new Set(signatures.map(s => normalizeSignerType(s.signerType)));
  const companyAutoSigned = !!lessorSignatureImage && !!lessorSignerName;

  // Find current signer to sign
  const currentSigner = requiredSigners.find(t => {
    if (t === 'COMPANY' && companyAutoSigned) return false;
    return !signedTypes.has(t);
  });

  const getGpsLocation = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => { setGpsLoading(false); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => { setGpsLoading(false); resolve(null); },
        { timeout: 3000, maximumAge: 120000 },
      );
    });
  }, []);

  const signMutation = useMutation({
    mutationFn: async (body: {
      signatureImage: string;
      signerType: string;
      signerName?: string;
      screenSize?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
    }) => {
      const { data } = await api.post(`/contracts/${contractId}/sign`, body);
      return data;
    },
    onSuccess: async (_data, variables) => {
      const label = SIGNER_LABELS[variables.signerType as SignerType] || variables.signerType;
      toast.success(`ลงนาม ${label} สำเร็จ`);
      setSignerName('');

      const freshSignatures = await queryClient.fetchQuery<Signature[]>({
        queryKey: ['contract-signatures', contractId],
        queryFn: async () => { const { data } = await api.get(`/contracts/${contractId}/signatures`); return data; },
      });

      const freshSignedTypes = new Set(freshSignatures.map(s => normalizeSignerType(s.signerType)));
      const allDone = requiredSigners.every(t => freshSignedTypes.has(t));
      if (allDone) onAllSigned();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteSignatureMutation = useMutation({
    mutationFn: async (signerType: string) => {
      await api.delete(`/contracts/${contractId}/signatures/${signerType}`);
    },
    onSuccess: (_data, signerType) => {
      toast.success(`ลบลายเซ็น ${SIGNER_LABELS[signerType as SignerType] || signerType} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['contract-signatures', contractId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Auto-sign COMPANY
  const companyNotSigned = !signedTypes.has('COMPANY');
  if (companyAutoSigned && companyNotSigned && !autoSignedCompany && !signMutation.isPending) {
    setAutoSignedCompany(true);
    signMutation.mutate({
      signatureImage: lessorSignatureImage,
      signerType: 'COMPANY',
      signerName: lessorSignerName,
      screenSize: `${window.screen.width}x${window.screen.height}`,
    });
  }

  const handleSign = async (signatureImage: string) => {
    if (!currentSigner) return;
    const gps = await getGpsLocation();
    signMutation.mutate({
      signatureImage,
      signerType: currentSigner,
      signerName: signerName || undefined,
      screenSize: `${window.screen.width}x${window.screen.height}`,
      gpsLatitude: gps?.lat,
      gpsLongitude: gps?.lng,
    });
  };

  const handleSignFromSaved = async () => {
    if (!savedSignature || !currentSigner) return;
    const gps = await getGpsLocation();
    signMutation.mutate({
      signatureImage: savedSignature,
      signerType: currentSigner,
      signerName: signerName || undefined,
      screenSize: `${window.screen.width}x${window.screen.height}`,
      gpsLatitude: gps?.lat,
      gpsLongitude: gps?.lng,
    });
  };

  const isBusy = signMutation.isPending || gpsLoading;
  const showSavedOption = currentSigner && (currentSigner === 'WITNESS_1' || currentSigner === 'WITNESS_2') && !!savedSignature;

  // All signed - should transition
  if (!currentSigner) {
    const allDone = requiredSigners.every(t => signedTypes.has(t));
    if (allDone) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
          <div className="text-5xl mb-4 text-green-500">&#10003;</div>
          <h2 className="text-xl font-semibold text-green-700">ลงนามครบถ้วนแล้ว</h2>
          <button onClick={onAllSigned} className="mt-6 px-8 py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
            ดำเนินการต่อ
          </button>
        </div>
      );
    }
    // Waiting for auto-sign
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 max-w-2xl mx-auto py-6">
      {/* Signature status chips */}
      <div className="flex flex-wrap gap-2 mb-6 justify-center">
        {requiredSigners.map(type => {
          const signed = signedTypes.has(type);
          const isCurrent = type === currentSigner;
          return (
            <div
              key={type}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${
                signed
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : isCurrent
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-muted border-border text-muted-foreground'
              }`}
            >
              {signed ? '\u2713 ' : ''}{SIGNER_LABELS[type]}
              {signed && type !== 'COMPANY' && (
                <button
                  onClick={() => {
                    if (window.confirm(`ต้องการลบลายเซ็น${SIGNER_LABELS[type]}และเซ็นใหม่?`)) {
                      deleteSignatureMutation.mutate(type);
                    }
                  }}
                  disabled={deleteSignatureMutation.isPending}
                  className="ml-1 text-2xs text-red-500 hover:text-red-700 underline"
                >
                  เซ็นใหม่
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Signer name input */}
      <div className="w-full mb-4">
        <label className="block text-xs text-muted-foreground mb-1">ชื่อผู้ลงนาม</label>
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder={`ระบุชื่อ${SIGNER_LABELS[currentSigner]}`}
          className="w-full px-4 py-3 border border-input rounded-xl text-sm"
        />
      </div>

      {/* GPS loading */}
      {gpsLoading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-border" />
          กำลังขอตำแหน่ง GPS...
        </div>
      )}

      {/* Saved signature option for witnesses */}
      {showSavedOption && (
        <div className="w-full mb-4 border-2 border-primary/20 bg-primary/5 rounded-xl p-4">
          <div className="text-sm font-medium text-primary mb-2">ลายเซ็นที่บันทึกไว้</div>
          <div className="bg-background rounded-lg border p-3 flex justify-center mb-3">
            <img src={savedSignature} alt="saved-signature" className="h-16" />
          </div>
          <button
            onClick={handleSignFromSaved}
            disabled={isBusy}
            className="w-full px-4 py-3 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {isBusy ? 'กำลังบันทึก...' : 'ใช้ลายเซ็นที่บันทึกไว้'}
          </button>
          <div className="text-center text-xs text-muted-foreground mt-2">หรือเซ็นใหม่ด้านล่าง</div>
        </div>
      )}

      {/* Signature pad */}
      <div className="w-full">
        <SignaturePadFull
          label={`ลงลายมือชื่อ: ${SIGNER_LABELS[currentSigner]}`}
          signerName={signerName || undefined}
          onSign={handleSign}
          isPending={isBusy}
        />
      </div>

      {/* Back button */}
      <button
        onClick={onBack}
        className="mt-6 px-6 py-2 text-sm text-muted-foreground hover:underline"
      >
        ย้อนกลับ
      </button>
    </div>
  );
}
