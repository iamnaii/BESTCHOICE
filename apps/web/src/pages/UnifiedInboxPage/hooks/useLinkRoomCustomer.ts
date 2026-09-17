import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ผูกลูกค้าเข้ากับห้องแชท — `PATCH /staff-chat/rooms/:id/customer`
 * ใช้ทั้ง "ค้นหาลูกค้าเดิม" (LinkCustomerDialog) และ "สร้างลูกค้าใหม่" (RoomDossier → CustomerCreateDialog)
 * รวมรายการ invalidate ไว้ที่เดียว: ห้องนี้ · รายการห้อง · รายชื่อลูกค้า · เครดิตที่อาจย้ายมาตามลูกค้า
 * ข้อความ toast เป็นของผู้เรียก (แต่ละทางเข้าพูดไม่เหมือนกัน)
 */
export const ROOM_LINK_INVALIDATE_KEYS = ['customers', 'credit-checks', 'customer-credit-checks', 'customer-latest-credit', 'customer-credit-check-latest-statement'] as const;

/** M-A4: ผลการรวมผู้สนใจอัตโนมัติที่การผูกห้องทำให้ (ห้องถือผู้สนใจอยู่ → ย้ายเข้าคนที่เลือก) */
export interface LinkedRoomAbsorb { targetId: string; movedCreditChecks: number }
/** `roomId` = ห้องที่ยิง PATCH จริง (จับตอน mutate — สลับห้องระหว่างรอแล้วยังชี้ห้องเดิม) · `absorbed` null = ไม่ได้รวม / API เก่า */
export interface LinkRoomResult { roomId: string; absorbed: LinkedRoomAbsorb | null }

/** อ่านแบบไม่เชื่อรูป — ไม่มี/ผิดรูป = null · ตัวนับที่ไม่ใช่ตัวเลข = 0 (แบบเดียวกับ toAbsorbResult) */
function toLinkedAbsorb(body: unknown): LinkedRoomAbsorb | null {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).absorbed : null;
  if (!raw || typeof raw !== 'object') return null;
  const { targetId, movedCreditChecks } = raw as Record<string, unknown>;
  if (typeof targetId !== 'string') return null;
  return {
    targetId,
    movedCreditChecks: typeof movedCreditChecks === 'number' && Number.isFinite(movedCreditChecks) ? movedCreditChecks : 0,
  };
}

export function useLinkRoomCustomer(roomId: string, opts: { onSuccess?: (customerId: string, result: LinkRoomResult) => void; onError?: (err: unknown, customerId: string) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string): Promise<LinkRoomResult> =>
      api
        .patch(`/staff-chat/rooms/${roomId}/customer`, { customerId })
        .then((res) => ({ roomId, absorbed: toLinkedAbsorb(res?.data?.data ?? res?.data) })),
    onSuccess: (result, customerId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      for (const key of ROOM_LINK_INVALIDATE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      opts.onSuccess?.(customerId, result);
    },
    onError: (err, customerId) => opts.onError?.(err, customerId),
  });
}
