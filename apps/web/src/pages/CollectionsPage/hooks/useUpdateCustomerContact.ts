import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

/**
 * Skip-tracing contact update payload (P2 Collections — D6).
 *
 * Mirrors `UpdateCustomerContactDto` on the API side. At least one of
 * `newPhone` / `newLineId` / `markAsLost` must be set, plus a non-empty
 * `reason` for the audit trail.
 */
export interface UpdateCustomerContactPayload {
  newPhone?: string;
  newLineId?: string;
  markAsLost?: boolean;
  reason: string;
}

export interface UpdateCustomerContactResponse {
  id: string;
  phone: string | null;
  phoneSecondary?: string | null;
  lineIdFinance: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOST';
  /** เบอร์ใหม่ถูกเก็บช่องไหน — SECONDARY = เบอร์นี้เป็นเบอร์หลักของลูกค้าคนอื่นอยู่แล้ว */
  phoneStoredAs?: 'PRIMARY' | 'SECONDARY' | null;
  /** ลูกค้าคนอื่นที่ถือเบอร์นี้ (เฉพาะ SECONDARY) */
  phoneOwner?: { id: string; name: string } | null;
}

/** ข้อความหลังบันทึกสำเร็จ — เบอร์ของคนอื่นต้องบอกผู้ใช้ว่าเก็บเป็นเบอร์สำรองแทน */
export function skipTracingSuccessMessage(
  data: UpdateCustomerContactResponse | undefined,
  payload: UpdateCustomerContactPayload,
): string {
  if (data?.phoneStoredAs === 'SECONDARY') {
    const phone = data.phoneSecondary || payload.newPhone || '';
    const owner = data.phoneOwner?.name || 'ลูกค้าคนอื่น';
    const extras = [
      payload.newLineId ? 'บันทึก LINE ID ใหม่แล้ว' : null,
      payload.markAsLost ? 'ทำเครื่องหมาย "สูญหาย" แล้ว' : null,
    ].filter(Boolean);
    const base = `เบอร์ ${phone} เป็นของ ${owner} — บันทึกเป็นเบอร์สำรองของลูกค้าคนนี้แทน`;
    return extras.length ? `${base} · ${extras.join(' · ')}` : base;
  }
  return payload.markAsLost ? 'ทำเครื่องหมาย "สูญหาย" แล้ว' : 'อัปเดตข้อมูลติดต่อแล้ว';
}

export function useUpdateCustomerContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerId,
      payload,
    }: {
      customerId: string;
      payload: UpdateCustomerContactPayload;
    }) => {
      const { data } = await api.post<UpdateCustomerContactResponse>(
        `/customers/${customerId}/update-contact`,
        payload,
      );
      return data;
    },
    onSuccess: (data, variables) => {
      toast.success(skipTracingSuccessMessage(data, variables.payload));
      // Refresh queue so updated phone / LOST tag propagates immediately.
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
      qc.invalidateQueries({ queryKey: ['customer', variables.customerId] });
      qc.invalidateQueries({ queryKey: ['customer-360', variables.customerId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
