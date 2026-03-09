import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';

interface CreditCheckData {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: any;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  checkedAt: string | null;
  customer: { id: string; name: string; salary: string | null; occupation: string | null };
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-gray-100 text-gray-700' },
  APPROVED: { label: 'ผ่าน', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-red-100 text-red-700' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-amber-100 text-amber-700' },
};

export default function CreditCheckPanel({ contractId }: { contractId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bankName, setBankName] = useState('');
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  const { data: creditCheck } = useQuery<CreditCheckData | null>({
    queryKey: ['credit-check', contractId],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}/credit-check`);
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const fileUrls: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        fileUrls.push(url);
      }

      const { data } = await api.post(`/contracts/${contractId}/credit-check`, {
        bankName: bankName || undefined,
        statementFiles: fileUrls,
        statementMonths: 3,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปโหลด Statement สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['credit-check', contractId] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/credit-check/analyze`);
      return data;
    },
    onSuccess: () => {
      toast.success('วิเคราะห์เครดิตเสร็จสิ้น');
      queryClient.invalidateQueries({ queryKey: ['credit-check', contractId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/credit-check/override`, {
        status: overrideStatus,
        reviewNotes: overrideNotes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะเครดิตเช็คแล้ว');
      queryClient.invalidateQueries({ queryKey: ['credit-check', contractId] });
      setOverrideStatus('');
      setOverrideNotes('');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadMutation.mutate(files);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const canOverride = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);

  return (
    <div className="space-y-4">
      {/* Upload Statement */}
      {!creditCheck && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">ตรวจสอบเครดิตลูกค้า</h3>
          <p className="text-xs text-gray-500">อัปโหลด Statement ธนาคารย้อนหลัง 3 เดือน เพื่อให้ AI วิเคราะห์ความสามารถในการผ่อนชำระ</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ธนาคาร</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="เช่น กสิกร, กรุงไทย..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Statement (ภาพ/PDF, 3 เดือน)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                onChange={handleFileUpload}
                disabled={uploadMutation.isPending}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
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
      )}

      {/* Credit Check Result */}
      {creditCheck && (
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">ผลตรวจสอบเครดิต</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusLabels[creditCheck.status]?.className || 'bg-gray-100'}`}>
              {statusLabels[creditCheck.status]?.label || creditCheck.status}
            </span>
          </div>

          {/* Bank info */}
          <div className="flex items-center gap-4 text-sm text-gray-600">
            {creditCheck.bankName && <span>ธนาคาร: {creditCheck.bankName}</span>}
            <span>Statement: {creditCheck.statementFiles.length} ไฟล์</span>
          </div>

          {/* Analyze button */}
          {creditCheck.status === 'PENDING' && (
            <button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {analyzeMutation.isPending ? 'กำลังวิเคราะห์...' : 'AI วิเคราะห์เครดิต'}
            </button>
          )}

          {/* AI Result */}
          {creditCheck.aiScore !== null && (
            <div className="space-y-3">
              {/* Score */}
              <div className="flex items-center gap-4">
                <div className={`text-3xl font-bold ${getScoreColor(creditCheck.aiScore)}`}>
                  {creditCheck.aiScore}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-1">คะแนนเครดิต (0-100)</div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${getScoreBg(creditCheck.aiScore)}`}
                      style={{ width: `${creditCheck.aiScore}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Summary */}
              {creditCheck.aiSummary && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">สรุปผลวิเคราะห์</div>
                  <div className="text-sm text-gray-800">{creditCheck.aiSummary}</div>
                </div>
              )}

              {/* Recommendation */}
              {creditCheck.aiRecommendation && (
                <div className={`rounded-lg p-3 ${
                  creditCheck.aiScore >= 70 ? 'bg-green-50' : creditCheck.aiScore >= 50 ? 'bg-amber-50' : 'bg-red-50'
                }`}>
                  <div className="text-xs text-gray-500 mb-1">คำแนะนำ</div>
                  <div className="text-sm font-medium">{creditCheck.aiRecommendation}</div>
                </div>
              )}

              {/* Analysis details */}
              {creditCheck.aiAnalysis && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {creditCheck.aiAnalysis.monthlyIncome > 0 && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-500">รายได้/เดือน</div>
                      <div className="text-sm font-medium">{creditCheck.aiAnalysis.monthlyIncome?.toLocaleString()} ฿</div>
                    </div>
                  )}
                  {creditCheck.aiAnalysis.monthlyPayment > 0 && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-500">ค่างวด/เดือน</div>
                      <div className="text-sm font-medium">{creditCheck.aiAnalysis.monthlyPayment?.toLocaleString()} ฿</div>
                    </div>
                  )}
                  {creditCheck.aiAnalysis.affordabilityRatio != null && !isNaN(creditCheck.aiAnalysis.affordabilityRatio) && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-500">สัดส่วนค่างวด/รายได้</div>
                      <div className="text-sm font-medium">{(creditCheck.aiAnalysis.affordabilityRatio * 100).toFixed(0)}%</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Manual review notes */}
          {creditCheck.checkedBy && (
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-blue-600">ตรวจสอบโดย: {creditCheck.checkedBy.name}</div>
              {creditCheck.reviewNotes && <div className="text-sm text-blue-800 mt-1">{creditCheck.reviewNotes}</div>}
            </div>
          )}

          {/* Override controls for managers */}
          {canOverride && creditCheck.aiScore !== null && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-xs text-gray-500 font-medium">Override ผลตรวจสอบ (สำหรับผู้จัดการ)</div>
              <div className="flex gap-2">
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">เลือกสถานะ...</option>
                  <option value="APPROVED">อนุมัติ</option>
                  <option value="REJECTED">ปฏิเสธ</option>
                  <option value="MANUAL_REVIEW">ตรวจเพิ่มเติม</option>
                </select>
                <input
                  type="text"
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  placeholder="หมายเหตุ..."
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={() => overrideMutation.mutate()}
                  disabled={!overrideStatus || overrideMutation.isPending}
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  บันทึก
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
