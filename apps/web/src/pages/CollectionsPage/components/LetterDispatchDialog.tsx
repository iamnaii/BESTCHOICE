import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { renderLetterPdf, type LetterTemplateData } from '../utils/letterPdfRenderer';
import { useLetterActions } from '../hooks/useLetterActions';
import type { LetterRow } from '../hooks/useLetterQueue';

interface Props {
  open: boolean;
  letter: LetterRow;
  initialMode: 'generate' | 'dispatch';
  onClose: () => void;
}

export default function LetterDispatchDialog({ open, letter, initialMode, onClose }: Props) {
  const [mode, setMode] = useState<'generate' | 'dispatch'>(initialMode);

  // Reset mode when letter changes or initialMode changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, letter.id]);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={mode === 'generate' ? 'สร้าง PDF หนังสือ' : 'บันทึกการส่งหนังสือ'}
    >
      {mode === 'generate' ? (
        <GenerateSection letter={letter} onGenerated={() => setMode('dispatch')} onClose={onClose} />
      ) : (
        <DispatchSection letter={letter} onClose={onClose} />
      )}
    </Modal>
  );
}

// ── GenerateSection ────────────────────────────────────────────────────────────

interface GenerateSectionProps {
  letter: LetterRow;
  onGenerated: () => void;
  onClose: () => void;
}

function GenerateSection({ letter, onGenerated, onClose }: GenerateSectionProps) {
  const [busy, setBusy] = useState(false);
  // When signature is missing, user must explicitly acknowledge before
  // the PDF can be generated. `proceedWithoutSignature` flips to true only
  // after the "สร้างต่อโดยไม่มีลายเซ็น" button is clicked.
  const [proceedWithoutSignature, setProceedWithoutSignature] = useState(false);
  const { markPdfGenerated } = useLetterActions();

  // Prefetch company info (OWNER role required — if request fails we catch gracefully)
  const companiesQuery = useQuery({
    queryKey: ['companies-for-letter'],
    queryFn: async () => {
      const { data } = await api.get('/companies');
      return data as Array<{
        id: string;
        companyCode: string | null;
        nameTh: string;
        taxId: string;
        address: string;
        phone: string | null;
        directorName: string;
        directorPosition: string | null;
        logoUrl: string | null;
      }>;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Must share queryKey with DunningSettingsPage so that when OWNER uploads
  // a signature, this dialog sees fresh data. `['settings']` is the source-of-
  // truth key used by DunningSettingsPage / InterestConfigPage / SettingsPage.
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get('/settings');
      return data as Array<{ key: string; value: string | null }>;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Compute config synchronously from already-loaded queries so the
  // "missing signature" warning can render inline (no `window.confirm`).
  const settings = settingsQuery.data ?? [];
  const findConfig = (key: string): string | null =>
    settings.find((s) => s.key === key)?.value ?? null;
  const signatureUrl = findConfig('letter_signature_url');
  const letterheadUrl = findConfig('letter_letterhead_url');

  const hasSignature = !!signatureUrl;
  const isLoadingDeps = companiesQuery.isLoading || settingsQuery.isLoading;

  // The generate button is blocked when signature is missing AND user has
  // not explicitly acknowledged via the "สร้างต่อโดยไม่มีลายเซ็น" button.
  const signatureCheckBlocked = !isLoadingDeps && !hasSignature && !proceedWithoutSignature;

  const handleGenerate = async () => {
    setBusy(true);
    try {
      // 1. Gather company + contract data
      const [contractRes] = await Promise.all([
        api.get(`/contracts/${letter.contractId}`).then((r) => r.data),
      ]);

      // Pick FINANCE company (the HP financer signing the letter)
      const companies = companiesQuery.data ?? [];
      const company =
        companies.find((c) => c.companyCode === 'FINANCE') ?? companies[0] ?? null;

      if (!company) {
        throw new Error('ไม่พบข้อมูลบริษัท (FINANCE) — โปรดตั้งค่า CompanyInfo ก่อน');
      }

      // Compute outstanding using Decimal (money arithmetic MUST NOT use
      // parseFloat — this balance appears on a court-submitted letter).
      const payments: Array<{
        status: string;
        amountDue: string;
        amountPaid: string;
        lateFee: string | null;
        dueDate: string;
      }> = (contractRes.payments ?? []).filter((p: { status: string }) =>
        ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
      );

      const outstandingDec = payments.reduce(
        (sum, p) =>
          sum
            .plus(new Decimal(p.amountDue ?? '0'))
            .minus(new Decimal(p.amountPaid ?? '0'))
            .plus(new Decimal(p.lateFee ?? '0')),
        new Decimal(0),
      );
      // renderLetterPdf expects a number — convert only at the very edge.
      const outstanding = outstandingDec.toNumber();

      const now = new Date();
      const oldest = payments
        .map((p) => new Date(p.dueDate))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const daysOverdue = oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86400000))
        : 0;

      const data: LetterTemplateData = {
        letterType: letter.letterType,
        letterNumber: letter.letterNumber,
        letterDate: new Date(),
        company: {
          nameTh: company.nameTh,
          taxId: company.taxId,
          address: company.address,
          phone: company.phone ?? undefined,
          directorName: company.directorName,
          directorPosition: company.directorPosition ?? undefined,
          // Use letterhead as logo if available, otherwise fall back to company logo
          logoUrl: letterheadUrl ?? company.logoUrl ?? undefined,
          signatureUrl: signatureUrl ?? undefined,
        },
        customer: {
          name: letter.contract.customer.name,
          address: letter.contract.customer.addressCurrent ?? null,
        },
        contract: {
          contractNumber: letter.contract.contractNumber,
          contractDate: contractRes.createdAt ? new Date(contractRes.createdAt) : null,
          outstanding,
          daysOverdue,
        },
      };

      // 2. Render PDF
      const blob = await renderLetterPdf(data);

      // 3. Presign upload URL
      const { data: presigned } = await api.post('/shop/upload/signed-url', {
        kind: 'LETTER_PDF',
        contentType: 'application/pdf',
      });

      // 4. PUT blob to S3
      const uploadRes = await fetch(presigned.uploadUrl, {
        method: presigned.method ?? 'PUT',
        body: blob,
        headers: { 'Content-Type': 'application/pdf' },
      });
      if (!uploadRes.ok) {
        throw new Error(`อัปโหลดไม่สำเร็จ (HTTP ${uploadRes.status})`);
      }

      // 5. Mark generated on backend
      await markPdfGenerated.mutateAsync({ letterId: letter.id, pdfUrl: presigned.publicUrl });

      toast.success('สร้าง PDF สำเร็จ');
      onGenerated();
    } catch (err) {
      toast.error(
        `สร้าง PDF ไม่สำเร็จ: ${err instanceof Error ? err.message : getErrorMessage(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      {/* Letter summary block */}
      <div className="rounded-lg bg-muted/40 border border-border p-3 text-sm space-y-1.5">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">เลขที่หนังสือ</span>
          <span className="font-mono text-xs tabular-nums">{letter.letterNumber}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">ลูกค้า</span>
          <span className="font-semibold leading-snug text-right">
            {letter.contract.customer.name}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">สัญญา</span>
          <span className="font-mono text-xs text-primary tabular-nums">
            {letter.contract.contractNumber}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">ประเภท</span>
          <span
            className={
              letter.letterType === 'CONTRACT_TERMINATION_60D'
                ? 'text-destructive font-medium leading-snug text-right'
                : 'text-warning font-medium leading-snug text-right'
            }
          >
            {letter.letterType === 'RETURN_DEVICE_45D'
              ? 'หนังสือทวงถามและเรียกเครื่องคืน 45 วัน'
              : 'หนังสือบอกเลิกสัญญา 60 วัน'}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground leading-snug">
        ระบบจะสร้าง PDF ภาษาไทย A4 พร้อมลายเซ็นจากการตั้งค่าและอัปโหลดไปที่ S3
        จากนั้นท่านสามารถดาวน์โหลดเพื่อพิมพ์และนำไปส่งไปรษณีย์ EMS
      </div>

      {isLoadingDeps && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          กำลังโหลดข้อมูลบริษัท...
        </div>
      )}

      {/* Inline warning — replaces window.confirm so the missing-signature
          decision is explicit, keyboard-accessible, and visible in the dialog */}
      {!isLoadingDeps && !hasSignature && (
        <div
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="leading-snug">
              <div className="font-semibold text-warning">ยังไม่มีลายเซ็นในระบบ</div>
              <div className="text-muted-foreground mt-0.5">
                PDF ที่สร้างจะไม่มีลายเซ็น — แนะนำให้อัปโหลดลายเซ็นในการตั้งค่าก่อน
                หรือกดปุ่มด้านล่างเพื่อสร้างต่อโดยไม่มีลายเซ็น
              </div>
            </div>
          </div>
          {!proceedWithoutSignature && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setProceedWithoutSignature(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warning/50 bg-background px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10 transition-colors"
              >
                สร้างต่อโดยไม่มีลายเซ็น
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || isLoadingDeps || signatureCheckBlocked}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังสร้าง...
            </>
          ) : (
            <>
              <FileText className="size-4" />
              สร้าง PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── DispatchSection ────────────────────────────────────────────────────────────

interface DispatchSectionProps {
  letter: LetterRow;
  onClose: () => void;
}

function DispatchSection({ letter, onClose }: DispatchSectionProps) {
  const [tracking, setTracking] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { dispatch } = useLetterActions();

  const handleSubmit = async () => {
    if (tracking.trim().length < 5) {
      toast.error('เลข tracking ต้อง ≥ 5 ตัวอักษร');
      return;
    }
    setBusy(true);
    try {
      let evidencePhotoUrl: string | undefined;

      if (evidenceFile) {
        const { data: presigned } = await api.post('/shop/upload/signed-url', {
          kind: 'LETTER_EVIDENCE',
          contentType: evidenceFile.type,
        });
        const up = await fetch(presigned.uploadUrl, {
          method: presigned.method ?? 'PUT',
          body: evidenceFile,
          headers: { 'Content-Type': evidenceFile.type },
        });
        if (!up.ok) throw new Error(`อัปโหลดรูปไม่สำเร็จ (HTTP ${up.status})`);
        evidencePhotoUrl = presigned.publicUrl;
      }

      await dispatch.mutateAsync({
        letterId: letter.id,
        trackingNumber: tracking.trim(),
        evidencePhotoUrl,
      });

      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const trackingValid = tracking.trim().length >= 5;

  return (
    <div className="space-y-4 p-1">
      {/* PDF download link */}
      {letter.pdfUrl && (
        <a
          href={letter.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Download className="size-4" />
          ดาวน์โหลด PDF ({letter.letterNumber})
        </a>
      )}

      {/* Letter info block */}
      <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">ลูกค้า</span>
          <span className="font-semibold leading-snug text-right">
            {letter.contract.customer.name}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground leading-snug">สัญญา</span>
          <span className="font-mono text-primary tabular-nums">
            {letter.contract.contractNumber}
          </span>
        </div>
      </div>

      {/* Tracking number input */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
          เลข EMS tracking *
        </label>
        <input
          type="text"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="เช่น EX123456789TH"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono tabular-nums bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        {tracking.length > 0 && !trackingValid && (
          <p className="text-[10px] text-destructive mt-1 leading-snug">
            ต้องกรอกอย่างน้อย 5 ตัวอักษร
          </p>
        )}
      </div>

      {/* Evidence photo upload */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug">
          รูปใบรับส่งไปรษณีย์ (ไม่บังคับ)
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium file:text-foreground hover:file:bg-accent cursor-pointer"
        />
        {evidenceFile && (
          <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
            {evidenceFile.name} ({(evidenceFile.size / 1024).toFixed(0)} KB)
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !trackingValid}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังบันทึก...
            </>
          ) : (
            <>
              <Upload className="size-4" />
              บันทึกส่งแล้ว
            </>
          )}
        </button>
      </div>
    </div>
  );
}
