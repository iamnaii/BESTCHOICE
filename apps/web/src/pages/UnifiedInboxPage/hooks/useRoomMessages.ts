import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import { describeSendError, SEND_ERROR_WINDOW, SEND_ERROR_TOKEN } from '../components/send-error';
import { resolveUploadFeedback } from '../components/upload-feedback';

export function useRoomMessages(activeRoomId: string | null, connectionStatus: string) {
  const queryClient = useQueryClient();
  // Send-status state: in-flight ghosts (keyed by token) + unified failed list (both roomId-scoped)
  const [pendingSends, setPendingSends] = useState<
    { clientMessageId: string; roomId: string; text: string }[]
  >([]);
  const [failedSends, setFailedSends] = useState<
    {
      id: string;
      roomId: string;
      text: string;
      source: 'http' | 'ws';
      clientMessageId: string;
      reason?: string;
    }[]
  >([]);

  // reason = เหตุจริงที่แปลเป็นไทยแล้ว (สเปก §8.1: ส่งไม่ถึงต้องบอกว่าทำไม ไม่เงียบ)
  const pushFailedSend = useCallback(
    (
      roomId: string,
      text: string,
      source: 'http' | 'ws',
      clientMessageId: string,
      reason?: string,
    ) => {
      setFailedSends((prev) => {
        // avoid a double entry if HTTP-catch and WS send-failed both fire for the same text
        const dup = prev.find((f) => f.roomId === roomId && f.text === text);
        if (dup) {
          // ไม่เพิ่มฟองซ้ำ แต่เหตุที่ "ดีกว่า" ทับได้: เหตุจาก WS (adapter รู้จริง) หรือเหตุที่แปลได้ (พ้น 24 ชม./token)
          // ชนะข้อความ HTTP ทั่วไปที่มาก่อน
          const better =
            !!reason &&
            (!dup.reason ||
              source === 'ws' ||
              reason === SEND_ERROR_WINDOW ||
              reason === SEND_ERROR_TOKEN);
          const retryToken = dup.clientMessageId || clientMessageId;
          return better || retryToken !== dup.clientMessageId
            ? prev.map((f) =>
                f === dup
                  ? { ...f, reason: better ? reason : f.reason, clientMessageId: retryToken }
                  : f,
              )
            : prev;
        }
        return [
          ...prev,
          { id: crypto.randomUUID(), roomId, text, source, clientMessageId, reason },
        ];
      });
    },
    [],
  );

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', activeRoomId],
    queryFn: () =>
      api
        .get(`/staff-chat/rooms/${activeRoomId}/messages`, {
          params: { limit: 100 },
        })
        .then((r) => r.data),
    enabled: !!activeRoomId,
    refetchInterval: connectionStatus === 'connected' ? 30000 : 5000, // Poll every 5s as fallback for WS
  });

  // Drop optimistic ghosts whose saved row (matched by clientMessageId) has
  // arrived in the message list. Belt to ChatPanel's display-time filter.
  useEffect(() => {
    const msgs = messagesQuery.data;
    if (!Array.isArray(msgs) || !activeRoomId) return;
    const landed = new Set(
      msgs.map((m: any) => m.clientMessageId).filter((id: unknown): id is string => !!id),
    );
    if (landed.size === 0) return;
    setPendingSends((prev) =>
      prev.filter((p) => !(p.roomId === activeRoomId && landed.has(p.clientMessageId))),
    );
  }, [messagesQuery.data, activeRoomId]);

  // Send via HTTP — WS is unreliable behind some proxies, so HTTP is the
  // source of truth for sending. WS is still used to receive real-time updates.
  // Returns true only when the message was accepted. Failure drives a FAILED ghost
  // (via pushFailedSend) — no toast; the FAILED ghost is the affordance.
  const sendRoomMessage = useCallback(
    async (text: string, reuseClientMessageId?: string): Promise<boolean> => {
      const roomId = activeRoomId;
      if (!roomId) return false;
      const clientMessageId = reuseClientMessageId || crypto.randomUUID();
      // Optimistic "กำลังส่ง" ghost — removed when the saved row (same token) lands
      // in the list, or on failure (replaced by a FAILED ghost).
      setPendingSends((prev) => [...prev, { clientMessageId, roomId, text }]);
      const removePending = () =>
        setPendingSends((prev) => prev.filter((p) => p.clientMessageId !== clientMessageId));
      try {
        const res = await api.post(`/staff-chat/rooms/${roomId}/messages`, {
          text,
          clientMessageId,
        });
        const data = res.data;
        if (data && data.success === false) {
          removePending();
          pushFailedSend(
            roomId,
            text,
            'http',
            clientMessageId,
            describeSendError(data.error ?? data.message) ?? undefined,
          );
          return false;
        }
        // Success — keep the ghost until the refetched row carries the token, then
        // the reconciliation effect prunes it. Trigger the refetch now.
        queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
        // Refresh the conversation list too so the room bubbles to the top with the
        // just-sent message as its preview (otherwise the left list stays stale
        // until the next inbound message / poll).
        queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
        return true;
      } catch (err: any) {
        removePending();
        const raw = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message;
        pushFailedSend(roomId, text, 'http', clientMessageId, describeSendError(raw) ?? undefined);
        return false;
      }
    },
    [activeRoomId, queryClient, pushFailedSend],
  );

  const handleSendMessage = sendRoomMessage;

  const handleSendSticker = useCallback(
    ({ packageId, stickerId }: { packageId: number; stickerId: number }) => {
      void sendRoomMessage(`[sticker:${packageId}:${stickerId}]`);
    },
    [sendRoomMessage],
  );

  // clientMessageId ต่อไฟล์ — คงค่าเดิมไว้ถ้า mutate() ถูกเรียกซ้ำด้วย File object
  // เดิม (เช่น retry ผ่าน react-query หรือ future retry-button ที่ถือ ref ของไฟล์
  // เดิมไว้) กันส่งรูปซ้ำให้ลูกค้า (idempotency contract จาก backend: unique
  // [roomId, clientMessageId] — ดู clientMessageIdRef ใน ProductPickerDialog.tsx
  // สำหรับ pattern เดียวกัน). ไฟล์ใหม่ (เลือก/ลากไฟล์ใหม่) เป็น File object คนละตัว
  // เสมอ จึงได้ id ใหม่โดยอัตโนมัติ — ไม่ต้อง reset ref เอง
  const uploadClientIdsRef = useRef(new WeakMap<File, string>());

  const uploadFileMutation = useMutation({
    mutationFn: async ({ file, roomId }: { file: File; roomId: string }) => {
      if (!roomId) throw new Error('ไม่มี room');
      let clientMessageId = uploadClientIdsRef.current.get(file);
      if (!clientMessageId) {
        clientMessageId = crypto.randomUUID();
        uploadClientIdsRef.current.set(file, clientMessageId);
      }
      const formData = new FormData();
      formData.append('file', file);
      // token กัน double-send เวลา retry (unique [roomId, clientMessageId] ฝั่ง DB)
      formData.append('clientMessageId', clientMessageId);
      const { data } = await api.post(`/staff-chat/rooms/${roomId}/upload`, formData);
      return data as { delivered?: boolean; error?: string };
    },
    onSuccess: (data, { roomId }) => {
      const feedback = resolveUploadFeedback(data);
      if (feedback.kind === 'success') {
        toast.success(feedback.message);
      } else if (feedback.kind === 'retryable') {
        toast.error(feedback.message);
      } else {
        toast.warning(feedback.message);
      }
      if (roomId) {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      }
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
        (err instanceof Error ? err.message : 'อัพโหลดไม่สำเร็จ');
      toast.error(msg);
    },
  });

  const handleSendFile = useCallback(
    (file: File) => {
      if (activeRoomId) uploadFileMutation.mutate({ file, roomId: activeRoomId });
    },
    [uploadFileMutation, activeRoomId],
  );

  const retrySend = useCallback(
    (failedId: string, text: string) => {
      const entry = failedSends.find((failed) => failed.id === failedId);
      if (!entry || entry.roomId !== activeRoomId) return;
      setFailedSends((prev) => prev.filter((failed) => failed.id !== failedId));
      void sendRoomMessage(text, entry.clientMessageId || undefined);
    },
    [failedSends, activeRoomId, sendRoomMessage],
  );

  return {
    messagesQuery,
    pendingSends,
    failedSends,
    pushFailedSend,
    handleSendMessage,
    handleSendSticker,
    handleSendFile,
    retrySend,
    isUploadingFile: uploadFileMutation.isPending,
  };
}
