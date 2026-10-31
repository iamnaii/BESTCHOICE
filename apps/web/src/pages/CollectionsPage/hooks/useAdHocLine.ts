import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

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
      return data as { sent: number; failed: number; total: number };
    },
    onSuccess: (data, vars) => {
      if (data.sent > 0) {
        toast.success('ส่ง LINE สำเร็จ');
      } else {
        // ลูกค้าที่ยังไม่ยืนยัน OTP ได้ 400 พร้อมเหตุจาก API แล้ว (Task 24 RR-M2) — เหลือกรณีระบบส่งไม่ผ่าน
        toast.error('ส่ง LINE ไม่สำเร็จ — ระบบส่งข้อความไม่ผ่าน กรุณาลองใหม่');
      }
      qc.invalidateQueries({ queryKey: ['customer-360', vars.contractId] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
