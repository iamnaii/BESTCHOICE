import { isRoomCreditDocument, openCreditDocument } from '@/lib/credit-document';
import { useEffect, useState, useRef } from 'react';
import QueryBoundary from '@/components/QueryBoundary';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getProtectedDocument } from '@/lib/document-download';
import { useAuth } from '@/contexts/AuthContext';
import { queryErrorMessage } from '@/lib/query-error-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Plus, Eye, Trash2, Loader2, FileText, Link2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { formatDateShort } from '@/utils/formatters';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { OcrResult } from '@/types/ocr';

interface ContractDocument {
  id: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  notes: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  isImmutable?: boolean;
}

// SIGNED_CONTRACT + PDPA_CONSENT ไม่รวมในรายการนี้ — backend สร้าง
// auto หลังเซ็น e-Signature (contract-documents.service.ts:77,82)
const DOCUMENT_TYPES = [
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', required: true },
  { value: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน', required: true },
  { value: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า', required: true },
  { value: 'DEVICE_IMEI_PHOTO', label: 'รูปถ่าย IMEI สินค้า', required: true },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook', required: true },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)', required: true },
  { value: 'LINE_PROFILE', label: 'Profile LINE', required: true },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง', required: true },
  { value: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง', required: false },
  { value: 'BANK_STATEMENT', label: 'Statement ธนาคาร / หลักฐานการทำงาน', required: true },
];

const OCR_TYPES: Record<string, { endpoint: string; label: string }> = {
  ID_CARD_COPY: { endpoint: '/ocr/id-card', label: 'บัตรประชาชน' },
};

export default function DocumentUpload({ contractId, customerId, contractStatus }: { contractId: string; customerId?: string; contractStatus?: string }) {
  const { user } = useAuth();
  const canUpload = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canEditCustomer = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const canDelete = canEditCustomer && !['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contractStatus ?? '');
  const uploadBusy = useRef(false);
  const closePreviewRef = useRef<HTMLButtonElement>(null);
  const fileButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastOpenedId = useRef('');
  const [documentPage, setDocumentPage] = useState(1);
  const queryClient = useQueryClient();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ url: string; name: string; label?: string } | null>(null);
  const [dragOverType, setDragOverType] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<{ type: string; message: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const documentsQuery = useQuery<{ data: ContractDocument[]; total: number }>({
    queryKey: ['contract-documents', contractId, documentPage],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}/documents`, { params: { page: documentPage, limit: 50 } });
      return data;
    },
  });
  const documents = documentsQuery.data?.data ?? [];
  const checklistQuery = useQuery<{ checklist: { type: string; present: boolean; autoGenerate: boolean }[] }>({
    queryKey: ['contract-doc-checklist', contractId],
    queryFn: async () => (await api.get(`/contracts/${contractId}/documents/checklist`)).data,
  });
  const types = DOCUMENT_TYPES.map(type => ({ ...type, required: !!checklistQuery.data?.checklist.some(row => row.type === type.value && !row.autoGenerate) }));

  // Pull statement files the customer/staff already uploaded at the credit-check
  // step — same document, no need to upload again. Prefer the credit check
  // linked to THIS contract; if none (or it has no files — e.g. the linked
  // check was an override-only record), fall back to the customer's latest
  // FULL credit check that does have files.
  const { data: contractCreditCheck } = useQuery<{ statementFiles: string[] } | null>({
    queryKey: ['contract-credit-check-statement', contractId],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/contracts/${contractId}/credit-check`);
        return data;
      } catch {
        return null;
      }
    },
  });
  const { data: customerCreditCheck } = useQuery<{ statementFiles: string[] } | null>({
    queryKey: ['customer-credit-check-latest-statement', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      try {
        const { data } = await api.get(`/customers/${customerId}/credit-check/latest`);
        return data;
      } catch {
        return null;
      }
    },
    enabled: !!customerId,
  });
  const contractFiles = contractCreditCheck?.statementFiles ?? [];
  const customerFiles = customerCreditCheck?.statementFiles ?? [];
  const statementFiles = contractFiles.length > 0 ? contractFiles : customerFiles;

  // Refresh attachments, the parent count and the shared required-type checklist.
  const refetchDocLists = () => {
    queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-doc-checklist', contractId] });
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      const reader = new FileReader();
      const fileUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
        reader.readAsDataURL(file);
      });
      const { data } = await api.post(`/contracts/${contractId}/documents`, {
        documentType,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        mimeType: file.type || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปโหลดเอกสารสำเร็จ');
      refetchDocLists();
    },
    onError: (err: unknown, variables) => {
      const message = `อัปโหลด ${variables.file.name} ไม่สำเร็จ · ${queryErrorMessage(err)}`;
      setUploadError({ type: variables.documentType, message });
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await api.delete(`/contracts/${contractId}/documents/${docId}`);
    },
    onSuccess: () => {
      toast.success('ลบเอกสารแล้ว');
      refetchDocLists();
    },
    onError: (err: unknown) => {
      toast.error(queryErrorMessage(err));
    },
  });

  const performOcr = async (file: File, docType: string) => {
    const cfg = OCR_TYPES[docType];
    if (!cfg) return;
    setOcrLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post(cfg.endpoint, { imageBase64 }, { timeout: 90000 });
      setOcrResult(data);
      setShowOcrPanel(true);
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) toast.error(`อ่าน${cfg.label}ได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      else if (data.confidence < 0.7) toast.warning(`อ่าน${cfg.label}สำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`);
      else toast.success(`อ่าน${cfg.label}สำเร็จ (ความมั่นใจ ${pct}%)`);
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: unknown };
      if (axiosErr.code === 'ECONNABORTED' || !axiosErr.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setOcrLoading(false);
    }
  };

  const buildOcrAddressJson = (data: OcrResult): string | undefined => {
    if (data.addressStructured) {
      const a = data.addressStructured;
      const hasData = Object.values(a).some((v) => v !== '');
      if (hasData) return JSON.stringify(a);
    }
    if (data.address) {
      const raw = data.address;
      const addr: Record<string, string> = {
        houseNo: '', moo: '', village: '', soi: '', road: '',
        province: '', district: '', subdistrict: '', postalCode: '',
      };
      const zipMatch = raw.match(/(\d{5})\s*$/);
      if (zipMatch) addr.postalCode = zipMatch[1];
      const houseMatch = raw.match(/^(\d+(?:\/\d+)?)\s/);
      if (houseMatch) addr.houseNo = houseMatch[1];
      const mooMatch = raw.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
      if (mooMatch) addr.moo = mooMatch[1];
      const soiMatch = raw.match(/(?:ซอย|ซ\.)\s*([^\s,]+)/);
      if (soiMatch) addr.soi = soiMatch[1];
      const roadMatch = raw.match(/(?:ถนน|ถ\.)\s*([^\s,]+)/);
      if (roadMatch) addr.road = roadMatch[1];
      const villageMatch = raw.match(/(?:หมู่บ้าน|ม\.บ\.|คอนโด)\s*([^\s,]+)/);
      if (villageMatch) addr.village = villageMatch[1];
      const subdistrictMatch = raw.match(/(?:ตำบล|ต\.|แขวง)\s*([^\s,]+)/);
      if (subdistrictMatch) addr.subdistrict = subdistrictMatch[1];
      const districtMatch = raw.match(/(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/);
      if (districtMatch) addr.district = districtMatch[1];
      const provinceMatch = raw.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
      if (provinceMatch) addr.province = provinceMatch[1];
      const hasStructured = Object.values(addr).some((v) => v !== '');
      if (hasStructured) return JSON.stringify(addr);
      return JSON.stringify({ ...addr, raw });
    }
    return undefined;
  };

  const updateCustomerFromOcr = async () => {
    if (!ocrResult || !customerId) return;
    try {
      const updateData: Record<string, unknown> = {};
      if (ocrResult.prefix) updateData.prefix = ocrResult.prefix;
      const name = [ocrResult.firstName, ocrResult.lastName].filter(Boolean).join(' ') || ocrResult.fullName;
      if (name) updateData.name = name.trim();
      if (ocrResult.birthDate) updateData.birthDate = ocrResult.birthDate;
      const addrJson = buildOcrAddressJson(ocrResult);
      if (addrJson) updateData.addressIdCard = addrJson;
      await api.patch(`/customers/${customerId}`, updateData);
      toast.success('อัปเดตข้อมูลลูกค้าสำเร็จ');
      setShowOcrPanel(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const validateFile = (file: File, docType: string): boolean => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return false;
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('รองรับไฟล์ JPG, PNG, GIF, WEBP หรือ PDF เท่านั้น');
      return false;
    }
    if (docType === 'ID_CARD_COPY' && !file.type.startsWith('image/')) {
      toast.error('สำเนาบัตรประชาชนต้องเป็นไฟล์รูปภาพเท่านั้น');
      return false;
    }
    return true;
  };

  const uploadFiles = async (files: FileList | File[], docType: string) => {
    if (!canUpload || uploadBusy.current) return;
    const valid = Array.from(files).filter(file => validateFile(file, docType));
    if (!valid.length) return;
    uploadBusy.current = true;
    setUploadError(null);
    setUploadingType(docType);
    try {
      // Keep the pending state until the entire batch settles; preserve version order.
      for (const file of valid) await uploadMutation.mutateAsync({ file, documentType: docType });
      if (OCR_TYPES[docType] && !ocrLoading) void performOcr(valid[0], docType);
    } catch {
      // The mutation shows the failure; successful earlier files are already refreshed.
    } finally {
      uploadBusy.current = false;
      setUploadingType(null);
    }
  };

  const openFileMutation = useMutation({
    mutationFn: async (doc: ContractDocument) => ({ doc, blob: await getProtectedDocument(`/contracts/${contractId}/documents/${doc.id}/content`) }),
    onSuccess: ({ doc, blob }) => {
      const label = DOCUMENT_TYPES.find(t => t.value === doc.documentType)?.label || doc.documentType;
      setViewingFile({ url: URL.createObjectURL(blob), name: doc.fileName, label });
    },
    onError: (error: unknown) => toast.error(queryErrorMessage(error)),
  });
  const openDocument = (doc: ContractDocument) => { lastOpenedId.current = doc.id; openFileMutation.mutate(doc); };
  useEffect(() => () => {
    if (viewingFile?.url.startsWith('blob:')) URL.revokeObjectURL(viewingFile.url);
  }, [viewingFile]);

  const hasTypeFiles = (dt: typeof DOCUMENT_TYPES[number]) => {
    return checklistQuery.data?.checklist.find(row => row.type === dt.value)?.present ?? (dt.value === 'BANK_STATEMENT' ? statementFiles.length > 0 : documents.some(d => d.documentType === dt.value));
  };
  const uploadedCount = types.filter(hasTypeFiles).length;
  const requiredTypes = types.filter((dt) => dt.required);
  const optionalTypes = types.filter((dt) => !dt.required);
  const requiredDone = requiredTypes.filter(hasTypeFiles).length;

  const renderBankStatementCard = (dt: typeof DOCUMENT_TYPES[number]) => {
    const hasFiles = statementFiles.length > 0;
    return (
      <div key={dt.value} className={`rounded-lg border overflow-hidden ${hasFiles ? 'border-primary/30 bg-card' : 'border-border bg-card'}`}>
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-border/50 ${hasFiles ? 'bg-primary/10' : 'bg-muted/40'}`}>
          {hasFiles ? (
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Circle className={`w-4 h-4 shrink-0 ${dt.required ? 'text-destructive/70' : 'text-muted-foreground/50'}`} />
          )}
          <span className={`text-sm font-medium truncate ${hasFiles || dt.required ? 'text-foreground' : 'text-muted-foreground'}`}>
            {dt.label} {dt.required && !hasFiles && <span className="text-destructive">*</span>}
          </span>
          {hasFiles && (
            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono shrink-0">{statementFiles.length}</span>
          )}
        </div>
        <div className="p-3 space-y-2">
          {hasFiles ? (
            <div className="grid grid-cols-3 gap-2">
              {statementFiles.map((url, idx) => {
                const isImage = url.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
                return (
                  <div key={idx} className="relative group aspect-square bg-muted rounded border border-border overflow-hidden">
                    {isImage ? (
                      <img src={url} alt={`statement-${idx + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
                        <FileText className="w-6 h-6 text-destructive" />
                        <div className="text-[9px] text-muted-foreground text-center truncate w-full px-1">Statement {idx + 1}</div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => { if (isRoomCreditDocument(url)) void openCreditDocument(url); else setViewingFile({ url, name: `Statement ${idx + 1}`, label: 'Statement ธนาคาร' }); }}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center bg-background/90 rounded text-foreground hover:bg-background"
                        aria-label="ดูเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="w-full border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center gap-1 text-center">
              <Link2 className="w-6 h-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">ยังไม่มีไฟล์</span>
              <span className="text-[10px] text-muted-foreground/70">อัปโหลดที่หน้าเช็คเครดิตของสัญญานี้</span>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground flex items-center gap-1 pt-1 border-t border-border/40">
            <Link2 className="w-3 h-3" />
            <span>ข้อมูลจากหน้าเช็คเครดิต — แก้ไขได้ที่หน้านั้น</span>
          </div>
        </div>
      </div>
    );
  };

  const renderCard = (dt: typeof DOCUMENT_TYPES[number]) => {
    if (dt.value === 'BANK_STATEMENT') return renderBankStatementCard(dt);
    const docs = documents.filter((d) => d.documentType === dt.value);
    const hasFiles = docs.length > 0;
    const isOver = dragOverType === dt.value;
    const isUploading = uploadingType === dt.value;

    return (
      <div
        key={dt.value}
        className={`rounded-lg border overflow-hidden transition-colors ${
          isOver ? 'border-primary bg-primary/5' : hasFiles ? 'border-primary/30 bg-card' : 'border-border bg-card'
        }`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (canUpload && !uploadBusy.current) setDragOverType(dt.value); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverType(null); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOverType(null);
          const files = e.dataTransfer.files;
          if (files && files.length > 0) uploadFiles(files, dt.value);
        }}
      >
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-border/50 ${hasFiles ? 'bg-primary/10' : 'bg-muted/40'}`}>
          {hasFiles ? (
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Circle className={`w-4 h-4 shrink-0 ${dt.required ? 'text-destructive/70' : 'text-muted-foreground/50'}`} />
          )}
          <span className={`text-sm font-medium truncate ${hasFiles || dt.required ? 'text-foreground' : 'text-muted-foreground'}`}>
            {dt.label} {dt.required && !hasFiles && <span className="text-destructive">*</span>}
          </span>
          {hasFiles && (
            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono shrink-0">{docs.length}</span>
          )}
        </div>

        <div className="p-3">
          {uploadError?.type === dt.value && <p role="alert" className="mb-3 text-sm text-foreground border-l-2 border-destructive pl-3">{uploadError.message} ไฟล์ที่สำเร็จบันทึกแล้ว กรุณาเลือกเฉพาะไฟล์ที่ยังไม่สำเร็จใหม่</p>}
          <input
            ref={(el) => { fileInputRefs.current[dt.value] = el; }}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) uploadFiles(files, dt.value);
              if (fileInputRefs.current[dt.value]) fileInputRefs.current[dt.value]!.value = '';
            }}
            className="hidden"
            disabled={!canUpload || uploadingType !== null}
            aria-label={`แนบ ${dt.label}`}
          />

          {hasFiles ? (
            <div className="grid grid-cols-3 gap-2">
              {docs.map((doc) => {
                const isImage = doc.fileUrl?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.fileName);
                return (
                  <div key={doc.id} className="relative group aspect-square bg-muted rounded border border-border overflow-hidden">
                    {isImage && doc.fileUrl ? (
                      <img src={doc.fileUrl} alt={doc.fileName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
                        <FileText className="w-6 h-6 text-destructive" />
                        <div className="text-[9px] text-muted-foreground text-center truncate w-full px-1">{doc.fileName}</div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition flex items-center justify-center gap-1">
                      <button
                        type="button"
                        ref={element => { fileButtons.current[doc.id] = element; }}
                        onClick={() => openDocument(doc)}
                        disabled={openFileMutation.isPending}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center bg-background/90 rounded text-foreground hover:bg-background"
                        aria-label="ดูเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canDelete && !doc.isImmutable && <button
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => setConfirmDialog({ open: true, message: `ต้องการลบเอกสาร "${doc.fileName}" หรือไม่?`, action: () => deleteMutation.mutate(doc.id) })}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center bg-destructive/90 rounded text-destructive-foreground hover:bg-destructive"
                        aria-label="ลบเอกสาร"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => fileInputRefs.current[dt.value]?.click()}
                disabled={!canUpload || uploadingType !== null}
                className="aspect-square border-2 border-dashed border-border hover:border-primary/50 rounded flex flex-col items-center justify-center gap-1 transition disabled:opacity-50"
              >
                {isUploading ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : (
                  <>
                    <Plus className="w-5 h-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">เพิ่ม</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRefs.current[dt.value]?.click()}
              disabled={!canUpload || uploadingType !== null}
              className={`w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-1 transition disabled:opacity-50 ${
                isOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              {isUploading ? (
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              ) : (
                <>
                  <Plus className={`w-6 h-6 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    {!canUpload ? 'ยังไม่มีไฟล์แนบ' : isOver ? 'ปล่อยไฟล์ที่นี่' : 'ลากไฟล์หรือคลิกเพิ่ม'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">{canUpload ? 'หลายไฟล์ได้' : 'ดูเอกสารได้เมื่อพนักงานแนบไฟล์'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <QueryBoundary isLoading={documentsQuery.isPending || checklistQuery.isPending} isError={documentsQuery.isError || checklistQuery.isError}
        error={documentsQuery.error ?? checklistQuery.error} onRetry={() => { void documentsQuery.refetch(); void checklistQuery.refetch(); }} errorTitle="โหลดไฟล์แนบไม่สำเร็จ">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">อัปโหลดเอกสาร</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            เอกสารที่ต้องแนบครบ {requiredDone}/{requiredTypes.length} ประเภท · ทั้งหมด {documentsQuery.data?.total ?? 0} ไฟล์
          </p>
        </div>
        <div className="w-40 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${(uploadedCount / DOCUMENT_TYPES.length) * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {requiredTypes.map(renderCard)}
      </div>

      <div className="pt-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">เอกสารเพิ่มเติม (ไม่บังคับ)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {optionalTypes.map(renderCard)}
        </div>
      </div>

      {(documentsQuery.data?.total ?? 0) > 50 && <div className="flex items-center justify-between gap-2 text-sm">
        <button className="min-h-11 px-3 border rounded-lg disabled:opacity-50" disabled={documentPage <= 1} onClick={() => setDocumentPage(documentPage - 1)}>ไฟล์หน้าก่อน</button>
        <span>หน้า {documentPage} / {Math.ceil((documentsQuery.data?.total ?? 0) / 50)}</span>
        <button className="min-h-11 px-3 border rounded-lg disabled:opacity-50" disabled={documentPage * 50 >= (documentsQuery.data?.total ?? 0)} onClick={() => setDocumentPage(documentPage + 1)}>ไฟล์หน้าถัดไป</button>
      </div>}
      </QueryBoundary>

      {openFileMutation.isPending && <p role="status" className="text-sm text-muted-foreground">กำลังเปิดเอกสาร…</p>}
      {ocrLoading && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
          <div>
            <div className="text-sm font-medium text-primary">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
            <div className="text-xs text-primary">ระบบ AI กำลังประมวลผลรูปภาพ</div>
          </div>
        </div>
      )}

      {showOcrPanel && ocrResult && (
        <div className={`${ocrResult.confidence < 0.7 ? 'bg-warning/10 border-warning/30' : 'bg-success/10 border-success/30'} border rounded-lg p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold ${ocrResult.confidence < 0.7 ? 'text-warning' : 'text-success'}`}>ข้อมูลที่อ่านจากบัตรประชาชน</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${ocrResult.confidence < 0.5 ? 'text-destructive font-bold' : ocrResult.confidence < 0.7 ? 'text-warning font-semibold' : 'text-success'}`}>ความมั่นใจ: {(ocrResult.confidence * 100).toFixed(0)}%</span>
              <button onClick={() => setShowOcrPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">ปิด</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ocrResult.nationalId && (
              <div>
                <div className="text-xs text-muted-foreground">เลขบัตรประชาชน</div>
                <div className="text-sm font-mono font-medium text-foreground">
                  {ocrResult.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                </div>
              </div>
            )}
            {ocrResult.prefix && (
              <div>
                <div className="text-xs text-muted-foreground">คำนำหน้า</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.prefix}</div>
              </div>
            )}
            {ocrResult.fullName && (
              <div>
                <div className="text-xs text-muted-foreground">ชื่อ-นามสกุล</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.fullName}</div>
              </div>
            )}
            {ocrResult.birthDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันเกิด</div>
                <div className="text-sm font-medium text-foreground">{formatDateShort(ocrResult.birthDate)}</div>
              </div>
            )}
            {ocrResult.address && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">ที่อยู่ตามบัตร</div>
                <div className="text-sm font-medium text-foreground">{ocrResult.address}</div>
              </div>
            )}
            {ocrResult.issueDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันออกบัตร</div>
                <div className="text-sm text-foreground">{formatDateShort(ocrResult.issueDate)}</div>
              </div>
            )}
            {ocrResult.expiryDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันหมดอายุ</div>
                <div className="text-sm text-foreground">{formatDateShort(ocrResult.expiryDate)}</div>
              </div>
            )}
          </div>
          {customerId && canEditCustomer && (
            <div className="flex gap-2 pt-2 border-t border-success/30">
              <button
                onClick={updateCustomerFromOcr}
                className="px-4 py-1.5 text-xs bg-success text-success-foreground rounded-lg hover:bg-success/90"
              >
                อัปเดตข้อมูลลูกค้า
              </button>
              <button
                onClick={() => setShowOcrPanel(false)}
                className="px-4 py-1.5 text-xs border border-border text-foreground rounded-lg hover:bg-muted"
              >
                ข้าม
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!viewingFile} onOpenChange={open => { if (!open) setViewingFile(null); }}>
        <DialogContent aria-describedby={undefined} showCloseButton={false} className="max-w-5xl w-[calc(100%-2rem)] max-h-[92dvh] p-4"
          onOpenAutoFocus={event => { event.preventDefault(); closePreviewRef.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); fileButtons.current[lastOpenedId.current]?.focus(); }}>
          <DialogHeader className="flex-row items-center justify-between gap-3"><DialogTitle className="min-w-0 break-words">ดูเอกสาร {viewingFile?.name}</DialogTitle>
            <button ref={closePreviewRef} onClick={() => setViewingFile(null)} className="min-h-11 min-w-11 px-3 shrink-0 border rounded-lg text-sm" aria-label="ปิดเอกสาร">ปิด</button>
          </DialogHeader>
          {viewingFile && <>
            <a href={viewingFile.url} download={viewingFile.name} className="min-h-11 inline-flex items-center justify-center self-start text-sm px-3 rounded border border-border hover:bg-accent">ดาวน์โหลดไฟล์นี้</a>
            <div className="bg-muted rounded-lg overflow-auto min-h-0">
              {(viewingFile.url.startsWith('data:image/') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(viewingFile.name) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(viewingFile.url))
                ? <img src={viewingFile.url} alt={viewingFile.name} className="mx-auto max-w-full max-h-[65dvh] object-contain" />
                : <iframe src={viewingFile.url} title={viewingFile.name} onLoad={() => closePreviewRef.current?.focus()} className="w-full h-[65dvh] border-0" />}
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
