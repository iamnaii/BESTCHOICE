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

export default function DocumentUpload({ contractId }: { contractId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState('ID_CARD_COPY');
  const [notes, setNotes] = useState('');

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    uploadMutation.mutate(file);
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
