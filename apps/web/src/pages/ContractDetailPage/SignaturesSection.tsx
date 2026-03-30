import api from '@/lib/api';
import type { ContractDetail } from './types';

interface SignaturesSectionProps {
  contract: ContractDetail;
  eDocuments: { id: string; documentType: string; fileUrl: string; fileHash: string; createdAt: string }[];
}

export default function SignaturesSection({ contract, eDocuments }: SignaturesSectionProps) {
  if (contract.signatures.length === 0 && eDocuments.length === 0) return null;

  const signedTypes = new Set(contract.signatures?.map((s) => s.signerType === 'STAFF' ? 'COMPANY' : s.signerType) || []);

  return (
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
            <div key={type} className={`p-2 rounded-lg text-center text-xs ${sig ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'}`}>
              {sig ? '\u2713' : '\u2B1C'} {label}
              {sig && <div className="text-2xs mt-0.5">{new Date(sig.signedAt).toLocaleDateString('th-TH')}</div>}
            </div>
          );
        })}
      </div>
      {contract.pdpaConsentId && (
        <div className="text-xs text-green-600 mb-3">{'\u2713'} ยินยอม PDPA แล้ว</div>
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
  );
}
