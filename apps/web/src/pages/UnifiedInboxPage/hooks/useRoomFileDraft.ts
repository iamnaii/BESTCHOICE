import { useRef, useState } from 'react';
import { isAcceptedFile } from '../components/upload-accept';
import { toast } from 'sonner';

/** Memory only: no customer documents are persisted to browser storage. */
export function useRoomFileDraft(roomId: string | undefined) {
  const [drafts, setDrafts] = useState<Record<string, File[]>>({});
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const files = roomId ? (drafts[roomId] ?? []) : [];
  const add = (incoming: File[]) => {
    if (!roomId) return;
    const accepted = incoming.filter(isAcceptedFile);
    if (accepted.length !== incoming.length) toast.error('รองรับรูปภาพ, PDF และ DOC');
    setDrafts((previous) => ({
      ...previous,
      [roomId]: [...(previous[roomId] ?? []), ...accepted],
    }));
  };
  const remove = (file: File) => {
    if (!roomId || sending.current) return;
    setDrafts((previous) => ({
      ...previous,
      [roomId]: (previous[roomId] ?? []).filter((item) => item !== file),
    }));
  };
  const send = async (upload: (file: File) => void | Promise<boolean | void>) => {
    if (!roomId || sending.current) return;
    // Capture both room and callback: changing room during upload must never
    // send remaining files to the newly opened customer or clear their draft.
    const outgoingRoom = roomId;
    const batch = files;
    sending.current = true;
    setBusy(true);
    try {
      for (const file of batch) {
        try {
          if ((await upload(file)) === false) break;
          setDrafts((previous) => ({
            ...previous,
            [outgoingRoom]: (previous[outgoingRoom] ?? []).filter((item) => item !== file),
          }));
        } catch {
          toast.error('ส่งไฟล์ไม่สำเร็จ ไฟล์ยังอยู่ในฉบับร่าง');
          break;
        }
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return { files, add, remove, send, busy };
}
