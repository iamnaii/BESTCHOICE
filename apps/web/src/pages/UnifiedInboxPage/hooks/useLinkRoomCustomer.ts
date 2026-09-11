import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ผูกลูกค้าเข้ากับห้องแชท — `PATCH /staff-chat/rooms/:id/customer`
 * ใช้ทั้ง "ค้นหาลูกค้าเดิม" (LinkCustomerDialog) และ "สร้างลูกค้าใหม่" (RoomDossier → CustomerCreateDialog)
 * รวมรายการ invalidate ไว้ที่เดียว: ห้องนี้ · รายการห้อง · รายชื่อลูกค้า · เครดิตที่อาจย้ายมาตามลูกค้า
 * ข้อความ toast เป็นของผู้เรียก (แต่ละทางเข้าพูดไม่เหมือนกัน)
 */
export const ROOM_LINK_INVALIDATE_KEYS = ['customers', 'credit-checks', 'customer-credit-checks', 'customer-latest-credit', 'customer-credit-check-latest-statement'] as const;

export function useLinkRoomCustomer(roomId: string, opts: { onSuccess?: (customerId: string) => void; onError?: (err: unknown, customerId: string) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => api.patch(`/staff-chat/rooms/${roomId}/customer`, { customerId }),
    onSuccess: (_res, customerId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      for (const key of ROOM_LINK_INVALIDATE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      opts.onSuccess?.(customerId);
    },
    onError: (err, customerId) => opts.onError?.(err, customerId),
  });
}
