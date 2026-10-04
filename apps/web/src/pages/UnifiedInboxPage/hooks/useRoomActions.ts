import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api from '@/lib/api';
import { toast } from 'sonner';

export function useRoomActions(
  activeRoomId: string | null,
  sessions: readonly { id: string }[],
  aiPaused: boolean,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidateRoom = (roomId: string) => {
    queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
  };

  const assignMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/assign`, { staffId }),
    onSuccess: (_data, { roomId }) => {
      toast.success('มอบหมายแล้ว');
      invalidateRoom(roomId);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/reopen`),
    onSuccess: (_data, roomId) => {
      invalidateRoom(roomId);
    },
    onError: () => toast.error('เลิกทำไม่สำเร็จ'),
  });

  const takeOverMutation = useMutation({
    mutationFn: (roomId: string) => api.post(`/chat-ai/take-over/${roomId}`),
    onSuccess: (_data, roomId) => {
      invalidateRoom(roomId);
    },
    onError: () => toast.error('สลับสถานะ AI ไม่สำเร็จ'),
  });

  const resolveMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/resolve`),
    onSuccess: (_data, roomId) => {
      invalidateRoom(roomId);
      // ปิดงานแล้วเด้งไปห้องถัดไปในรายการ ให้ไล่คิวได้ต่อเนื่อง (เจ้าของเคาะ 2026-09-06) · เลิกทำ = กลับมาห้องเดิม
      if (roomId === activeRoomId) {
        const idx = sessions.findIndex((s) => s.id === roomId);
        const next = idx >= 0 ? (sessions[idx + 1] ?? sessions[idx - 1]) : undefined;
        navigate(next ? `/inbox/${next.id}` : '/inbox');
      }
      toast.success('ปิดแชทแล้ว', {
        action: {
          label: 'เลิกทำ',
          onClick: () => {
            reopenMutation.mutate(roomId);
            navigate(`/inbox/${roomId}`);
          },
        },
      });
    },
    onError: () => toast.error('ปิดแชทไม่สำเร็จ'),
  });

  const returnToAIMutation = useMutation({
    mutationFn: (roomId: string) => api.patch(`/staff-chat/rooms/${roomId}/return-to-ai`),
    onSuccess: (_data, roomId) => {
      invalidateRoom(roomId);
      toast.success('ส่งกลับ Bot แล้ว', {
        action: { label: 'เลิกทำ', onClick: () => takeOverMutation.mutate(roomId) },
      });
    },
    onError: () => toast.error('ส่งกลับ Bot ไม่สำเร็จ'),
  });

  const releaseToAiMutation = useMutation({
    mutationFn: (roomId: string) => api.post(`/chat-ai/release-to-ai/${roomId}`),
    onSuccess: (_data, roomId) => {
      invalidateRoom(roomId);
    },
    onError: () => toast.error('สลับสถานะ AI ไม่สำเร็จ'),
  });

  const aiTogglePending = takeOverMutation.isPending || releaseToAiMutation.isPending;
  const handleToggleAi = () => {
    if (!activeRoomId) return;
    if (aiPaused) releaseToAiMutation.mutate(activeRoomId);
    else takeOverMutation.mutate(activeRoomId);
  };

  const transferMutation = useMutation({
    mutationFn: ({ roomId, staffId }: { roomId: string; staffId: string }) =>
      api.patch(`/staff-chat/rooms/${roomId}/transfer`, { staffId }),
    onSuccess: (_data, { roomId }) => {
      toast.success('โอนห้องสำเร็จ');
      invalidateRoom(roomId);
      queryClient.invalidateQueries({ queryKey: ['staff-online'] });
    },
  });

  return {
    assignMutation,
    transferMutation,
    resolveMutation,
    reopenMutation,
    returnToAIMutation,
    aiTogglePending,
    handleToggleAi,
  };
}
