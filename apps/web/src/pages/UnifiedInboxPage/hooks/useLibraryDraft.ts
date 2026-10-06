import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatLibraryFile, LibraryDeliveryResult } from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
export interface LibraryDraftItem {
  file: ChatLibraryFile;
  requestKey: string;
  status: 'STAGED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'VERIFY';
  error?: string;
}
export function useLibraryDraft(
  roomId: string | null,
  company: 'SHOP' | 'FINANCE',
  active: boolean,
  purpose: 'chat' | 'credit',
) {
  const client = useQueryClient();
  const identity = `${company}:${roomId}:${purpose}`;
  const [drafts, setDrafts] = useState<Record<string, LibraryDraftItem[]>>({});
  const [open, setOpen] = useState(false);
  const current = useRef({ identity, active });
  current.current = { identity, active };
  useEffect(() => {
    setOpen(false);
  }, [identity, active]);
  const busy = useRef(new Set<string>());
  const items = drafts[identity] ?? [];
  const update = (key: string, fn: (items: LibraryDraftItem[]) => LibraryDraftItem[]) =>
    setDrafts((prev) => ({ ...prev, [key]: fn(prev[key] ?? []) }));
  const add = (files: ChatLibraryFile[]) => {
    if (!active || !roomId) return;
    update(identity, (prev) =>
      [
        ...prev,
        ...files
          .filter((f) => f.company === company && !prev.some((p) => p.file.id === f.id))
          .map((file) => ({ file, requestKey: crypto.randomUUID(), status: 'STAGED' as const })),
      ].slice(0, 10),
    );
    setOpen(false);
  };
  const send = async () => {
    if (
      !roomId ||
      !current.current.active ||
      current.current.identity !== identity ||
      busy.current.has(identity)
    )
      return;
    busy.current.add(identity);
    try {
      for (const item of items.filter((i) => i.status === 'STAGED' || i.status === 'FAILED' || i.status === 'VERIFY')) {
        if (!current.current.active || current.current.identity !== identity) break;
        update(identity, (prev) =>
          prev.map((p) =>
            p.requestKey === item.requestKey ? { ...p, status: 'SENDING', error: undefined } : p,
          ),
        );
        const ref = { fileId: item.file.id, requestKey: item.requestKey };
        let result: Pick<LibraryDraftItem, 'status' | 'error'>;
        try {
          if (purpose === 'credit') {
            await api.post(`/staff-chat/library/rooms/${roomId}/credit`, ref, {
              params: { company },
            });
            result = { status: 'SENT' };
          } else {
            result = (
              await api.post<LibraryDeliveryResult[]>(
                `/staff-chat/library/rooms/${roomId}/send`,
                { mode: 'chat', items: [ref] },
                { params: { company } },
              )
            ).data[0];
            if (!result) throw new Error('No acknowledgement');
          }
        } catch (error) {
          // Transport loss may follow a committed send. Keep the same token on explicit retry;
          // the server resolves its durable ACK state and never blindly calls the adapter again.
          result = { status: purpose === 'chat' ? 'VERIFY' : 'FAILED', error: getErrorMessage(error) };
        }
        update(identity, (prev) =>
          prev.map((p) =>
            p.requestKey === item.requestKey
              ? { ...p, status: result.status, error: result.error }
              : p,
          ),
        );
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['chat-messages', roomId] }),
        client.invalidateQueries({ queryKey: ['room-credit', roomId] }),
        client.invalidateQueries({ queryKey: ['chat-work'] }),
      ]);
    } finally {
      busy.current.delete(identity);
    }
  };
  return {
    items,
    open: open && active,
    setOpen,
    add,
    send,
    purpose,
    canSend:
      active &&
      !!roomId &&
      items.some((i) => i.status === 'STAGED' || i.status === 'FAILED' || i.status === 'VERIFY') &&
      !items.some((i) => i.status === 'SENDING'),
    remove: (token: string) =>
      update(identity, (prev) =>
        prev.filter(
          (p) => p.requestKey !== token || p.status === 'SENDING' || p.status === 'UNKNOWN' || p.status === 'VERIFY',
        ),
      ),
  };
}
