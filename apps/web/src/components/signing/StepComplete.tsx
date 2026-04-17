import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';

interface StepCompleteProps {
  contractId: string;
  contractNumber: string;
  productName?: string;
  totalMonths?: number;
  monthlyPayment?: number;
}

export default function StepComplete({
  contractId,
  contractNumber,
  productName,
  totalMonths,
  monthlyPayment,
}: StepCompleteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/generate-signed-documents`);
      return data;
    },
    onSuccess: (data) => {
      const contractOk = !!data?.contract;
      const pdpaOk = !!data?.pdpa;
      if (contractOk && pdpaOk) {
        toast.success('สร้างเอกสารสัญญาและ PDPA สำเร็จ');
      } else if (contractOk) {
        toast.success('สร้างเอกสารสัญญาสำเร็จ');
      } else if (pdpaOk) {
        toast.success('สร้างเอกสาร PDPA สำเร็จ');
      } else {
        toast.error('ไม่สามารถสร้างเอกสารได้');
      }
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Auto-generate on mount
  const autoGenRef = { current: false };
  if (!autoGenRef.current && !generateMutation.isPending && !generateMutation.isSuccess && !generateMutation.isError) {
    autoGenRef.current = true;
    generateMutation.mutate();
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="text-6xl mb-6 text-success">&#10003;</div>
      <h2 className="text-2xl font-bold text-foreground mb-2">เซ็นสัญญาเรียบร้อยแล้ว!</h2>
      <p className="text-muted-foreground mb-6">สัญญาเลขที่ {contractNumber}</p>

      {productName && (
        <div className="bg-muted rounded-xl p-4 mb-6 max-w-sm w-full">
          <div className="text-sm font-medium">{productName}</div>
          {totalMonths && monthlyPayment && (
            <div className="text-xs text-muted-foreground mt-1">
              ผ่อน {totalMonths} งวด x {monthlyPayment?.toLocaleString()} บาท
            </div>
          )}
        </div>
      )}

      {/* PDF generation status */}
      <div className="mb-6 w-full max-w-sm">
        {generateMutation.isPending && (
          <div className="flex items-center justify-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            <span className="text-sm">กำลังสร้างเอกสาร PDF...</span>
          </div>
        )}
        {generateMutation.isSuccess && (
          <div className="text-sm text-success font-medium">สร้างเอกสาร PDF เรียบร้อย</div>
        )}
        {generateMutation.isError && (
          <div className="space-y-2">
            <div className="text-sm text-destructive">สร้างเอกสารไม่สำเร็จ</div>
            <button
              onClick={() => generateMutation.mutate()}
              className="px-4 py-2 text-sm bg-destructive/10 text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/20"
            >
              ลองใหม่
            </button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="space-y-3 w-full max-w-sm">
        <button
          onClick={() => navigate(`/contracts/${contractId}`)}
          className="w-full px-6 py-3.5 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 font-medium"
        >
          ดูรายละเอียดสัญญา
        </button>
        <button
          onClick={() => navigate('/contracts')}
          className="w-full px-6 py-3.5 text-sm border border-input rounded-xl hover:bg-muted"
        >
          กลับไปหน้ารายการสัญญา
        </button>
      </div>
    </div>
  );
}
