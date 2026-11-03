import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import type { LineSendResult } from '../lineSendResult';

export interface SendLineAdHocPayload {
  contractId: string;
  templateId?: string;
  customMessage?: string;
}

export function useAdHocLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, ...body }: SendLineAdHocPayload) => {
      const { data } = await api.post(`/overdue/${contractId}/send-line-adhoc`, body);
      return data as LineSendResult;
    },
    onSuccess: (data, vars) => {
      if (data.sent > 0) {
        toast.success('ส่ง LINE สำเร็จ');
      } else {
        // ลูกค้าที่ยังไม่ยืนยัน OTP ได้ 400 พร้อมเหตุจาก API แล้ว (Task 24 RR-M2) · Task 34 ข้อ 2 — ถูกระงับ (ไม่มีความยินยอม PDPA /
        // ทวงวันนี้ไปแล้ว) · นอกเวลาทำการ · ส่งไม่ผ่านแล้วเข้าคิวส่งซ้ำ = แสดงเหตุผลจาก API (ไม่บอกว่าส่งแล้ว)
        toast.error(
          data.notSent?.[0]?.reasonText ??
            'ส่ง LINE ไม่สำเร็จ — ระบบส่งข้อความไม่ผ่าน กรุณาลองใหม่',
        );
      }
      qc.invalidateQueries({ queryKey: ['customer-360', vars.contractId] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
