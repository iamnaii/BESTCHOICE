/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState, useCallback } from 'react';
import api from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';

export interface OcrPaymentSlipResult {
  amount: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverAccountNo: string | null;
  transactionRef: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  slipType: string | null;
  confidence: number;
}

export function usePaymentOcr(onAutoFill?: (data: OcrPaymentSlipResult) => void) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrPaymentSlipResult | null>(null);

  const reset = useCallback(() => setResult(null), []);

  const handleScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) { toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB'); return; }
    if (!file.type.startsWith('image/')) { toast.error('กรุณาเลือกไฟล์รูปภาพ'); return; }

    setLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrPaymentSlipResult>('/ocr/payment-slip', { imageBase64 }, { timeout: 90000 });
      setResult(data);
      if (onAutoFill) onAutoFill(data);

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านสลิปได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านสลิปสำเร็จ ความมั่นใจ ${pct}% กรุณาตรวจสอบ`);
      } else {
        toast.success(`อ่านสลิปสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [onAutoFill]);

  return { fileRef, loading, result, reset, handleScan };
}
