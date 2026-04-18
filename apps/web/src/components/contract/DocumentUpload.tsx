import { useState, useRef, useCallback } from 'react';
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
}

const DOCUMENT_TYPES = [
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', required: true },
  { value: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน', required: true },
  { value: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า', required: true },
  { value: 'DEVICE_IMEI_PHOTO', label: 'รูปถ่าย IMEI สินค้า', required: true },
  { value: 'SIGNED_CONTRACT', label: 'PDF สัญญาที่เซ็นแล้ว (อัตโนมัติจากระบบ)', required: true },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook', required: true },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)', required: true },
  { value: 'LINE_PROFILE', label: 'Profile LINE', required: true },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง', required: true },
  { value: 'BANK_STATEMENT', label: 'Statement ธนาคาร / หลักฐานการทำงาน', required: true },
];

const OCR_TYPES: Record<string, { endpoint: string; label: string }> = {
  ID_CARD_COPY: { endpoint: '/ocr/id-card', label: 'บัตรประชาชน' },
};

export default function DocumentUpload({ contractId, customerId }: { contractId: string; customerId?: string }) {
  const queryClient = useQueryClient();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<ContractDocument | null>(null);
  const [dragOverType, setDragOverType] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data: documents = [] } = useQuery<ContractDocument[]>({
    queryKey: ['contract-documents', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}/documents`, { params: { limit: 200 } });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const { data: creditCheck } = useQuery<{ statementFiles: string[] } | null>({
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
  const statementFiles = creditCheck?.statementFiles ?? [];

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
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
    onSettled: () => {
      setUploadingType(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await api.delete(`/contracts/${contractId}/documents/${docId}`);
    },
    onSuccess: () => {
      toast.success('ลบเอกสารแล้ว');
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
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
    const validTypes = ['image/', 'application/pdf'];
    if (!validTypes.some((t) => file.type.startsWith(t))) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น');
      return false;
    }
    if (docType === 'ID_CARD_COPY' && !file.type.startsWith('image/')) {
      toast.error('สำเนาบัตรประชาชนต้องเป็นไฟล์รูปภาพเท่านั้น');
      return false;
    }
    return true;
  };

  const uploadFiles = useCallback((files: FileList | File[], docType: string) => {
    const fileArr = Array.from(files);
    const valid = fileArr.filter((f) => validateFile(f, docType));
    if (valid.length === 0) return;
    setUploadingType(docType);
    valid.forEach((file, idx) => {
      uploadMutation.mutate({ file, documentType: docType }, {
        onSuccess: () => {
          if (idx === 0 && OCR_TYPES[docType] && file.type.startsWith('image/') && !ocrLoading) {
            performOcr(file, docType);
          }
        },
      });
    });
  }, [uploadMutation, ocrLoading]);

  const openDocument = (doc: ContractDocument) => {
    if (!doc.fileUrl) return;
    if (doc.fileUrl.startsWith('data:')) {
      const isImage = doc.fileUrl.startsWith('data:image/');
      if (isImage) { setViewingDoc(doc); return; }
      try {
        const commaIdx = doc.fileUrl.indexOf(',');
        if (commaIdx === -1) { setViewingDoc(doc); return; }
        const header = doc.fileUrl.substring(0, commaIdx);
        const base64 = doc.fileUrl.substring(commaIdx + 1);
        const mimeMatch = header.match(/data:([^;]+)/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');
        if (!win) { URL.revokeObjectURL(url); setViewingDoc(doc); return; }
        win.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 5000));
      } catch {
        setViewingDoc(doc);
      }
    } else {
      const win = window.open(doc.fileUrl, '_blank');
      if (!win) toast.error('เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup สำหรับเว็บนี้');
    }
  };

  const hasTypeFiles = (dt: typeof DOCUMENT_TYPES[number]) => {
    if (dt.value === 'BANK_STATEMENT') return statementFiles.length > 0;
    return documents.some((d) => d.documentType === dt.value);
  };
  const uploadedCount = DOCUMENT_TYPES.filter(hasTypeFiles).length;
  const requiredTypes = DOCUMENT_TYPES.filter((dt) => dt.required);
  const optionalTypes = DOCUMENT_TYPES.filter((dt) => !dt.required);
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
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 bg-background/90 rounded text-foreground hover:bg-background"
                        aria-label="ดูเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </a>
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
    const isUploading = uploadingType === dt.value && uploadMutation.isPending;

    return (
      <div
        key={dt.value}
        className={`rounded-lg border overflow-hidden transition-colors ${
          isOver ? 'border-primary bg-primary/5' : hasFiles ? 'border-primary/30 bg-card' : 'border-border bg-card'
        }`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverType(dt.value); }}
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
          <input
            ref={(el) => { fileInputRefs.current[dt.value] = el; }}
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) uploadFiles(files, dt.value);
              if (fileInputRefs.current[dt.value]) fileInputRefs.current[dt.value]!.value = '';
            }}
            className="hidden"
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
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openDocument(doc)}
                        className="p-1.5 bg-background/90 rounded text-foreground hover:bg-background"
                        aria-label="ดูเอกสาร"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDialog({ open: true, message: `ต้องการลบเอกสาร "${doc.fileName}" หรือไม่?`, action: () => deleteMutation.mutate(doc.id) })}
                        className="p-1.5 bg-destructive/90 rounded text-destructive-foreground hover:bg-destructive"
                        aria-label="ลบเอกสาร"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => fileInputRefs.current[dt.value]?.click()}
                disabled={isUploading}
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
              disabled={isUploading}
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
                    {isOver ? 'ปล่อยไฟล์ที่นี่' : 'ลากไฟล์หรือคลิกเพิ่ม'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">หลายไฟล์ได้</span>
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">อัปโหลดเอกสาร</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {uploadedCount} จาก {DOCUMENT_TYPES.length} ประเภทครบ · {documents.length} ไฟล์ · บังคับ {requiredDone}/{requiredTypes.length}
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
          {customerId && (
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

      {viewingDoc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setViewingDoc(null)} onKeyDown={(e) => { if (e.key === 'Escape') setViewingDoc(null); }} role="dialog" aria-modal="true" aria-label={`ดูเอกสาร ${viewingDoc.fileName}`} tabIndex={-1} ref={(el) => el?.focus()}>
          <div className="relative max-w-4xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-card rounded-t-lg px-4 py-2">
              <div className="text-sm font-medium text-foreground">
                {DOCUMENT_TYPES.find((t) => t.value === viewingDoc.documentType)?.label || viewingDoc.documentType} - {viewingDoc.fileName}
              </div>
              <button onClick={() => setViewingDoc(null)} className="text-muted-foreground hover:text-foreground text-lg font-bold px-2">
                &times;
              </button>
            </div>
            <div className="bg-muted rounded-b-lg overflow-auto max-h-[calc(90vh-48px)] flex items-center justify-center">
              {viewingDoc.fileUrl.startsWith('data:image/') ? (
                <img src={viewingDoc.fileUrl} alt={viewingDoc.fileName} className="max-w-full max-h-[calc(90vh-48px)] object-contain" />
              ) : (
                <iframe src={viewingDoc.fileUrl} title={viewingDoc.fileName} className="w-full h-[80vh] border-0" />
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
