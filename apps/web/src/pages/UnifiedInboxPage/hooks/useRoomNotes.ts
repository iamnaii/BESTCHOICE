import type { NoteDraft } from '../components/NoteMentionInput';
import { useChatWorkSettings } from './useChatWork';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export function useRoomNotes(activeRoomId: string | null) {
  const work = useChatWorkSettings();
  const queryClient = useQueryClient();
  // Fetch messages for active room
  // โน้ตภายในของห้อง — รวมเข้าไทม์ไลน์กับข้อความ (สเปกแผงกลาง 2026-09-06)
  const notesQuery = useQuery({
    queryKey: ['chat-notes', activeRoomId, ...work.key],
    queryFn: () =>
      api
        .get(`/staff-chat/rooms/${activeRoomId}/notes`, { params: work.scope })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!activeRoomId,
  });
  const invalidateNotes = (roomId: string) => {
    queryClient.invalidateQueries({ queryKey: ['chat-notes', roomId] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
    queryClient.invalidateQueries({ queryKey: ['chat-work'] });
  };
  const addNoteMutation = useMutation({
    mutationFn: ({ roomId, ...draft }: { roomId: string } & NoteDraft) =>
      api
        .post(`/staff-chat/rooms/${roomId}/notes`, draft, { params: work.scope })
        .then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('บันทึกโน้ตไม่สำเร็จ'),
  });
  const pinNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/notes/${noteId}/pin`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('ปักหมุดไม่สำเร็จ'),
  });
  const unpinNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.delete(`/staff-chat/rooms/${roomId}/notes/${noteId}/pin`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: () => toast.error('ปลดหมุดไม่สำเร็จ'),
  });
  const deleteNoteMutation = useMutation({
    mutationFn: ({ roomId, noteId }: { roomId: string; noteId: string }) =>
      api.delete(`/staff-chat/rooms/${roomId}/notes/${noteId}`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateNotes(v.roomId),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ลบโน้ตไม่สำเร็จ'),
  });

  return { notesQuery, addNoteMutation, pinNoteMutation, unpinNoteMutation, deleteNoteMutation };
}
