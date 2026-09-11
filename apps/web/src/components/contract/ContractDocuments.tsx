import type { SignatureRequirements } from '@installment/shared';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { downloadGeneratedDocument } from '@/lib/document-download';
import { queryErrorMessage } from '@/lib/query-error-message';
import { formatDateMedium } from '@/utils/formatters';

interface Signature {
  id: string;
  signerType: string;
  signedAt: string;
}

interface EDocument {
  id: string;
  documentType: string;
  fileUrl: string;
  fileHash: string;
  createdAt: string;
}

interface ContractDocumentsProps {
  signatureRequirements?: SignatureRequirements;
  signatures: Signature[];
  eDocuments: EDocument[];
  pdpaConsentId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Signing status and e-document downloads section */
export default function ContractDocuments({ signatureRequirements, signatures, eDocuments, pdpaConsentId, isLoading, isError, error, onRetry, page, total, onPageChange }: ContractDocumentsProps) {
  const download = useMutation({
    mutationFn: (doc: EDocument) => downloadGeneratedDocument(doc.id, `${doc.documentType}_${doc.id}.${/\.pdf$/i.test(doc.fileUrl) ? 'pdf' : 'html'}`),
    onError: (error: unknown) => toast.error(queryErrorMessage(error)),
  });

  return (
    <div className="rounded-lg border p-4 mb-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">สถานะเอกสารและลายเซ็น</h3>
      {!signatureRequirements && <p className="mb-3 text-sm text-muted-foreground">ยังโหลดรายการผู้ลงนามที่ต้องใช้ไม่สำเร็จ</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {(signatureRequirements?.checklist ?? []).map(({ type, label }) => {
          const sig = (signatures || []).find(s => (s.signerType === 'STAFF' ? 'COMPANY' : s.signerType) === type);
          return (
            <div key={type} className={`p-2 rounded-lg text-center text-xs ${sig ? 'bg-success/5 dark:bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
              {sig ? '\u2713' : '\u2B1C'} {label}
              {sig && <div className="text-2xs mt-0.5">{formatDateMedium(sig.signedAt)}</div>}
            </div>
          );
        })}
      </div>
      {pdpaConsentId && (
        <div className="text-xs text-success mb-3">{'\u2713'} ยินยอม PDPA แล้ว</div>
      )}
      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={onRetry} errorTitle="โหลดเอกสารที่ระบบสร้างไม่สำเร็จ">
      {eDocuments.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-medium">เอกสารที่ระบบสร้าง:</div>
          {eDocuments.map(doc => (
            <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 p-2 bg-muted rounded-lg">
              <div className="text-xs">
                <span className="font-medium">{doc.documentType === 'CONTRACT' ? 'สัญญา' : doc.documentType === 'PDPA_CONSENT' ? 'PDPA' : doc.documentType} · {/\.pdf$/i.test(doc.fileUrl) ? 'PDF' : 'HTML'}</span>
                <span className="text-muted-foreground ml-2">{formatDateMedium(doc.createdAt)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => download.mutate(doc)}
                  disabled={download.isPending}
                  className="min-h-11 px-3 py-2 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {download.isPending && download.variables?.id === doc.id ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลด'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">ยังไม่มีเอกสารที่ระบบสร้าง</p>}
      {total > 20 && <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <button className="min-h-11 px-3 border rounded-lg disabled:opacity-50" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>ก่อนหน้า</button>
        <span>หน้า {page} / {Math.ceil(total / 20)}</span>
        <button className="min-h-11 px-3 border rounded-lg disabled:opacity-50" disabled={page * 20 >= total} onClick={() => onPageChange(page + 1)}>ถัดไป</button>
      </div>}
      </QueryBoundary>
    </div>
  );
}
