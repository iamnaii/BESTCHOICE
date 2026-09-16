import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { ROOM_LINK_INVALIDATE_KEYS } from './useLinkRoomCustomer';

/**
 * การกระทำบนการ์ด "ผู้สนใจจากแชท" ในแผงขวา (สเปค 3.3 ข / 3.6)
 * - รวม placeholder เข้าคนเดิม: `POST /customers/:placeholderId/absorb-into/:targetId` (ทางเดียว placeholder → คนจริง
 *   หรือ placeholder → placeholder ตามทิศทางที่คำใบ้บอก — R22) · หลังรวม ห้องนี้ชี้ไปคนที่รอด จึงต้องโหลดห้องใหม่
 * - กด "ไม่ใช่" ที่คำใบ้: `PATCH /staff-chat/rooms/:id/same-person/dismiss` — เก็บในห้อง ไม่ถามซ้ำ
 * toast เป็นของผู้เรียก (ข้อความต่างกันตามทางเข้า) — แบบเดียวกับ useLinkRoomCustomer
 */
export interface AbsorbArgs { placeholderId: string; targetId: string }

/** ผลของการรวม — รูปเดียวกับ `AbsorbResult` ของ customer-merge.service (API คืนตรง ๆ ไม่มีห่อ) */
export interface AbsorbResult { placeholderId: string; targetId: string; movedRooms: number; movedCreditChecks: number }

/** อ่านผลแบบไม่เชื่อรูป — ตัวนับที่หาย/ไม่ใช่ตัวเลข = 0 · id ที่หายถอยไปใช้ค่าที่ส่งไป */
function toAbsorbResult(body: unknown, args: AbsorbArgs): AbsorbResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    placeholderId: typeof b.placeholderId === 'string' ? b.placeholderId : args.placeholderId,
    targetId: typeof b.targetId === 'string' ? b.targetId : args.targetId,
    movedRooms: count(b.movedRooms),
    movedCreditChecks: count(b.movedCreditChecks),
  };
}

export function useAbsorbCustomer(roomId: string, opts: { onSuccess?: (args: AbsorbArgs, result: AbsorbResult) => void; onError?: (err: unknown, args: AbsorbArgs) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: AbsorbArgs) =>
      api.post(`/customers/${args.placeholderId}/absorb-into/${args.targetId}`).then((res) => toAbsorbResult(res?.data?.data ?? res?.data, args)),
    onSuccess: (result, args) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      for (const key of ROOM_LINK_INVALIDATE_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
      opts.onSuccess?.(args, result);
    },
    onError: (err, args) => opts.onError?.(err, args),
  });
}

export function useDismissSamePerson(roomId: string, opts: { onSuccess?: (customerId: string) => void; onError?: (err: unknown, customerId: string) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => api.patch(`/staff-chat/rooms/${roomId}/same-person/dismiss`, { customerId }),
    onSuccess: (_res, customerId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      opts.onSuccess?.(customerId);
    },
    onError: (err, customerId) => opts.onError?.(err, customerId),
  });
}
