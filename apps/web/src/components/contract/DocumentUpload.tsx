import { useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { toast } from 'sonner';
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
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)' },
  { value: 'ID_CARD_BACK', label: 'สำเนาบัตรประชาชน (หลัง)' },
  { value: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน' },
  { value: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า' },
  { value: 'DEVICE_IMEI_PHOTO', label: 'รูปถ่าย IMEI สินค้า' },
  { value: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานการชำระเงินดาวน์' },
  { value: 'PDPA_CONSENT', label: 'เอกสาร Consent PDPA' },
  { value: 'SIGNED_CONTRACT', label: 'PDF สัญญาที่เซ็นแล้ว' },
  { value: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)' },
  { value: 'KYC', label: 'เอกสาร KYC อื่นๆ' },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook' },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)' },
  { value: 'LINE_PROFILE', label: 'Profile LINE' },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง' },
  { value: 'BANK_STATEMENT', label: 'Statement ธนาคาร' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

export default function DocumentUpload({ contractId, customerId }: { contractId: string; customerId?: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState('ID_CARD_COPY');
  const [notes, setNotes] = useState('');
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<ContractDocument | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const { data: documents = [] } = useQuery<ContractDocument[]>({
    queryKey: ['contract-documents', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}/documents`);
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const reader = new FileReader();
      const fileUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
        reader.readAsDataURL(file);
      });

      const { data } = await api.post(`/contracts/${contractId}/documents`, {
        documentType: selectedType,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        mimeType: file.type || undefined,
        notes: notes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปโหลดเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      setNotes('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
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

  const performOcr = async (file: File) => {
    setOcrLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 90000 });
      setOcrResult(data);
      setShowOcrPanel(true);
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`);
      } else {
        toast.success(`อ่านบัตรประชาชนสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setOcrLoading(false);
    }
  };

  // Helper: build structured address JSON from OCR result
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
      // Wrap raw address text as JSON for consistent backend parsing
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
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear drag state when actually leaving the drop zone (not moving over children)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    const validTypes = ['image/', 'application/pdf'];
    if (!validTypes.some((t) => file.type.startsWith(t))) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น');
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Check file type for ID card before uploading
    const isIdCard = selectedType === 'ID_CARD_COPY';
    if (isIdCard && !file.type.startsWith('image/')) {
      toast.error('สำเนาบัตรประชาชนต้องเป็นไฟล์รูปภาพเท่านั้น');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    const fileToProcess = selectedFile;
    const typeToProcess = selectedType;

    uploadMutation.mutate(fileToProcess, {
      onSuccess: () => {
        // Trigger OCR only after upload succeeds, using captured references
        if (typeToProcess === 'ID_CARD_COPY' && fileToProcess.type.startsWith('image/') && !ocrLoading) {
          performOcr(fileToProcess);
        }
      },
    });
  };

  const getTypeLabel = (type: string) => DOCUMENT_TYPES.find((t) => t.value === type)?.label || type;

  const openDocument = (doc: ContractDocument) => {
    if (!doc.fileUrl) return;
    // For base64 data URLs, convert to blob and open or show in modal
    if (doc.fileUrl.startsWith('data:')) {
      const isImage = doc.fileUrl.startsWith('data:image/');
      if (isImage) {
        setViewingDoc(doc);
        return;
      }
      // For PDFs and other files, convert base64 to blob URL
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
        if (!win) {
          // Popup blocked - fallback to modal view
          URL.revokeObjectURL(url);
          setViewingDoc(doc);
          return;
        }
        // Revoke blob URL after new window loads (cleanup memory)
        win.addEventListener('load', () => {
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        });
      } catch {
        // Fallback: show in modal
        setViewingDoc(doc);
      }
    } else {
      const win = window.open(doc.fileUrl, '_blank');
      if (!win) {
        toast.error('เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup สำหรับเว็บนี้');
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload form */}
      <div className="bg-card rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">อัปโหลดเอกสาร</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">ประเภทเอกสาร</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">หมายเหตุ (ไม่บังคับ)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุ..."
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-primary bg-primary/5'
              : selectedFile
                ? 'border-green-400 bg-green-50'
                : 'border-border hover:border-primary/40 hover:bg-muted'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileChange}
            disabled={uploadMutation.isPending}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            {selectedFile ? (
              <>
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm font-medium text-green-700">{selectedFile.name}</div>
                <p className="text-xs text-green-500">{(selectedFile.size / 1024).toFixed(0)} KB — คลิก &quot;อัปโหลดเอกสาร&quot; หรือเลือกไฟล์ใหม่</p>
              </>
            ) : (
              <>
                <svg className={`w-8 h-8 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div className={`text-sm font-medium ${isDragOver ? 'text-primary' : 'text-foreground'}`}>
                  {isDragOver ? 'ปล่อยไฟล์เพื่ออัปโหลด' : 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์'}
                </div>
                <p className="text-xs text-muted-foreground">รองรับไฟล์ภาพ และ PDF ขนาดไม่เกิน 10MB</p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploadMutation.isPending}
            className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                กำลังอัปโหลด...
              </span>
            ) : 'อัปโหลดเอกสาร'}
          </button>
        </div>
      </div>

      {/* OCR Loading */}
      {ocrLoading && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          <div>
            <div className="text-sm font-medium text-primary">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
            <div className="text-xs text-primary">ระบบ AI กำลังประมวลผลรูปภาพ</div>
          </div>
        </div>
      )}

      {/* OCR Results Panel */}
      {showOcrPanel && ocrResult && (
        <div className={`${ocrResult.confidence < 0.7 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'} border rounded-lg p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold ${ocrResult.confidence < 0.7 ? 'text-yellow-800' : 'text-green-800'}`}>ข้อมูลที่อ่านจากบัตรประชาชน</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${ocrResult.confidence < 0.5 ? 'text-red-600 font-bold' : ocrResult.confidence < 0.7 ? 'text-yellow-600 font-semibold' : 'text-green-600'}`}>ความมั่นใจ: {(ocrResult.confidence * 100).toFixed(0)}%</span>
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
                <div className="text-sm font-medium text-foreground">{new Date(ocrResult.birthDate).toLocaleDateString('th-TH')}</div>
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
                <div className="text-sm text-foreground">{new Date(ocrResult.issueDate).toLocaleDateString('th-TH')}</div>
              </div>
            )}
            {ocrResult.expiryDate && (
              <div>
                <div className="text-xs text-muted-foreground">วันหมดอายุ</div>
                <div className="text-sm text-foreground">{new Date(ocrResult.expiryDate).toLocaleDateString('th-TH')}</div>
              </div>
            )}
          </div>
          {customerId && (
            <div className="flex gap-2 pt-2 border-t border-green-200">
              <button
                onClick={updateCustomerFromOcr}
                className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
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

      {/* Document list */}
      {documents.length > 0 && (
        <div className="bg-card rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold text-foreground">เอกสารที่แนบ ({documents.length})</h3>
          </div>
          <div className="divide-y">
            {documents.map((doc) => (
              <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                    doc.fileName.endsWith('.pdf') ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
                  }`}>
                    {doc.fileName.endsWith('.pdf') ? 'PDF' : 'IMG'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{doc.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {getTypeLabel(doc.documentType)}
                      {doc.notes && ` - ${doc.notes}`}
                      {' | '}อัปโหลดโดย {doc.uploadedBy.name}
                      {' | '}{new Date(doc.createdAt).toLocaleDateString('th-TH')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.fileUrl && (
                    <button
                      onClick={() => openDocument(doc)}
                      className="text-xs text-primary hover:text-primary/90 px-2 py-1"
                    >
                      ดู
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`ต้องการลบเอกสาร "${doc.fileName}" (${getTypeLabel(doc.documentType)}) หรือไม่?`)) deleteMutation.mutate(doc.id);
                    }}
                    className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Document viewer modal */}
      {viewingDoc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setViewingDoc(null)} onKeyDown={(e) => { if (e.key === 'Escape') setViewingDoc(null); }} role="dialog" aria-modal="true" aria-label={`ดูเอกสาร ${viewingDoc.fileName}`} tabIndex={-1} ref={(el) => el?.focus()}>
          <div className="relative max-w-4xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-card rounded-t-lg px-4 py-2">
              <div className="text-sm font-medium text-foreground">
                {getTypeLabel(viewingDoc.documentType)} - {viewingDoc.fileName}
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
    </div>
  );
}
