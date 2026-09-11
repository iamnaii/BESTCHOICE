import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api from '@/lib/api';
import { queryErrorMessage } from '@/lib/query-error-message';
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
      const contractOk = data?.contract?.pdfGenerated === true;
      const pdpaOk = data?.pdpa?.pdfGenerated === true;
      if (data?.errors?.length) {
        toast.error('PDF ยังไม่ครบ กรุณาลองสร้างเอกสารใหม่');
      } else if (contractOk && pdpaOk) {
        toast.success('สร้างเอกสารสัญญาและ PDPA สำเร็จ');
      } else if (contractOk) {
        toast.success('สร้างเอกสารสัญญาสำเร็จ');
      } else if (pdpaOk) {
        toast.success('สร้างเอกสาร PDPA สำเร็จ');
      } else {
        toast.error('PDF ยังไม่ครบ กรุณาลองสร้างเอกสารใหม่');
      }
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-edocuments', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-signatures', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-preview', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-doc-checklist', contractId] });
    },
    onError: (err: unknown) => toast.error(queryErrorMessage(err)),
  });

  // A real ref survives rerenders and StrictMode's effect replay.
  const startedFor = useRef<string | null>(null);
  const generate = generateMutation.mutate;
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || startedFor.current === contractId) return;
      startedFor.current = contractId;
      generate();
    });
    return () => { cancelled = true; };
  }, [contractId, generate]);
  const pdfComplete = generateMutation.data?.contract?.pdfGenerated === true && generateMutation.data?.pdpa?.pdfGenerated === true && !generateMutation.data?.errors?.length;
  const incomplete = generateMutation.isSuccess && !pdfComplete;

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
          <div role="status" className="flex items-center justify-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            <span className="text-sm">กำลังสร้างเอกสาร PDF...</span>
          </div>
        )}
        {generateMutation.isSuccess && pdfComplete && (
          <div className="text-sm text-success font-medium">สร้างเอกสาร PDF เรียบร้อย</div>
        )}
        {(generateMutation.isError || incomplete) && (
          <div role="alert" className="space-y-2">
            <div className="text-sm text-foreground">{incomplete ? 'PDF ยังไม่ครบ เอกสารบางฉบับอาจเป็น HTML กรุณาลองสร้างใหม่' : queryErrorMessage(generateMutation.error)}</div>
            <button
              onClick={() => generateMutation.mutate()}
              className="min-h-11 px-4 py-2 text-sm bg-destructive/10 text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/20"
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
