import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';

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
  { value: 'SIGNED_CONTRACT', label: 'PDF สัญญาที่เซ็นแล้ว' },
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน' },
  { value: 'KYC', label: 'เอกสาร KYC' },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook' },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด' },
  { value: 'LINE_PROFILE', label: 'Profile LINE' },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง' },
  { value: 'BANK_STATEMENT', label: 'Statement ธนาคาร' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

interface OcrAddressStructured {
  houseNo: string;
  moo: string;
  village: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

interface OcrResult {
  nationalId: string | null;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  address: string | null;
  addressStructured: OcrAddressStructured | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
}

export default function DocumentUpload({ contractId, customerId }: { contractId: string; customerId?: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState('ID_CARD_COPY');
  const [notes, setNotes] = useState('');
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);

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
        notes: notes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปโหลดเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      setNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'อัปโหลดไม่สำเร็จ');
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
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'ลบเอกสารไม่สำเร็จ');
    },
  });

  const performOcr = async (file: File) => {
    setOcrLoading(true);
    try {
      const reader = new FileReader();
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
        reader.readAsDataURL(file);
      });
      const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 60000 });
      setOcrResult(data);
      setShowOcrPanel(true);
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else if (data.confidence < 0.7) {
        toast(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`, { icon: '⚠️' });
      } else {
        toast.success(`อ่านบัตรประชาชนสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'ไม่สามารถอ่านบัตรประชาชนได้');
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
      return raw;
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
      toast.error(err.response?.data?.message || 'อัปเดตข้อมูลลูกค้าไม่สำเร็จ');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }

    // Check file type for ID card before uploading
    const isIdCard = selectedType === 'ID_CARD_COPY';
    if (isIdCard && !file.type.startsWith('image/')) {
      toast.error('สำเนาบัตรประชาชนต้องเป็นไฟล์รูปภาพเท่านั้น');
      return;
    }

    uploadMutation.mutate(file);

    // Trigger OCR when uploading ID card image
    if (isIdCard && file.type.startsWith('image/') && !ocrLoading) {
      performOcr(file);
    }
  };

  const getTypeLabel = (type: string) => DOCUMENT_TYPES.find((t) => t.value === type)?.label || type;

  return (
    <div className="space-y-4">
      {/* Upload form */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">อัปโหลดเอกสาร</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">ประเภทเอกสาร</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">หมายเหตุ (ไม่บังคับ)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุ..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">เลือกไฟล์</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileChange}
              disabled={uploadMutation.isPending}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50"
            />
          </div>
        </div>
        {uploadMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-primary-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
            กำลังอัปโหลด...
          </div>
        )}
      </div>

      {/* OCR Loading */}
      {ocrLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          <div>
            <div className="text-sm font-medium text-blue-800">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
            <div className="text-xs text-blue-600">ระบบ AI กำลังประมวลผลรูปภาพ</div>
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
              <button onClick={() => setShowOcrPanel(false)} className="text-xs text-gray-500 hover:text-gray-700">ปิด</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ocrResult.nationalId && (
              <div>
                <div className="text-xs text-gray-500">เลขบัตรประชาชน</div>
                <div className="text-sm font-mono font-medium text-gray-900">
                  {ocrResult.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                </div>
              </div>
            )}
            {ocrResult.prefix && (
              <div>
                <div className="text-xs text-gray-500">คำนำหน้า</div>
                <div className="text-sm font-medium text-gray-900">{ocrResult.prefix}</div>
              </div>
            )}
            {ocrResult.fullName && (
              <div>
                <div className="text-xs text-gray-500">ชื่อ-นามสกุล</div>
                <div className="text-sm font-medium text-gray-900">{ocrResult.fullName}</div>
              </div>
            )}
            {ocrResult.birthDate && (
              <div>
                <div className="text-xs text-gray-500">วันเกิด</div>
                <div className="text-sm font-medium text-gray-900">{new Date(ocrResult.birthDate).toLocaleDateString('th-TH')}</div>
              </div>
            )}
            {ocrResult.address && (
              <div className="col-span-2">
                <div className="text-xs text-gray-500">ที่อยู่ตามบัตร</div>
                <div className="text-sm font-medium text-gray-900">{ocrResult.address}</div>
              </div>
            )}
            {ocrResult.issueDate && (
              <div>
                <div className="text-xs text-gray-500">วันออกบัตร</div>
                <div className="text-sm text-gray-700">{new Date(ocrResult.issueDate).toLocaleDateString('th-TH')}</div>
              </div>
            )}
            {ocrResult.expiryDate && (
              <div>
                <div className="text-xs text-gray-500">วันหมดอายุ</div>
                <div className="text-sm text-gray-700">{new Date(ocrResult.expiryDate).toLocaleDateString('th-TH')}</div>
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
                className="px-4 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                ข้าม
              </button>
            </div>
          )}
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold text-gray-900">เอกสารที่แนบ ({documents.length})</h3>
          </div>
          <div className="divide-y">
            {documents.map((doc) => (
              <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                    doc.fileName.endsWith('.pdf') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {doc.fileName.endsWith('.pdf') ? 'PDF' : 'IMG'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{doc.fileName}</div>
                    <div className="text-xs text-gray-500">
                      {getTypeLabel(doc.documentType)}
                      {doc.notes && ` - ${doc.notes}`}
                      {' | '}อัปโหลดโดย {doc.uploadedBy.name}
                      {' | '}{new Date(doc.createdAt).toLocaleDateString('th-TH')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.fileUrl && (
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:text-primary-800 px-2 py-1"
                    >
                      ดู
                    </a>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('ต้องการลบเอกสารนี้?')) deleteMutation.mutate(doc.id);
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
    </div>
  );
}
