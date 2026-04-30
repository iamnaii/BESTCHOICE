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
  lineIdFinance: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOST';
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
    onSuccess: (_data, variables) => {
      toast.success(
        variables.payload.markAsLost
          ? 'ทำเครื่องหมาย "สูญหาย" แล้ว'
          : 'อัปเดตข้อมูลติดต่อแล้ว',
      );
      // Refresh queue so updated phone / LOST tag propagates immediately.
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
      qc.invalidateQueries({ queryKey: ['customer', variables.customerId] });
      qc.invalidateQueries({ queryKey: ['customer-360', variables.customerId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
