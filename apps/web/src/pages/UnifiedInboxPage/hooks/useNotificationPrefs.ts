import { useCallback, useEffect, useState } from 'react';

const MUTE_ALL_KEY = 'inbox.muteAll';
const MUTED_ROOMS_KEY = 'inbox.mutedRooms';

export function computeIsMuted(muteAll: boolean, mutedRooms: Set<string>, roomId?: string): boolean {
  if (muteAll) return true;
  return !!roomId && mutedRooms.has(roomId);
}

function readMuteAll(): boolean {
  try {
    return localStorage.getItem(MUTE_ALL_KEY) === 'true';
  } catch {
    return false;
  }
}

function readMutedRooms(): Set<string> {
  try {
    const raw = localStorage.getItem(MUTED_ROOMS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useNotificationPrefs() {
  const [muteAll, setMuteAll] = useState(readMuteAll);
  const [mutedRooms, setMutedRooms] = useState<Set<string>>(readMutedRooms);

  useEffect(() => {
    try {
      localStorage.setItem(MUTE_ALL_KEY, String(muteAll));
    } catch {}
  }, [muteAll]);

  useEffect(() => {
    try {
      localStorage.setItem(MUTED_ROOMS_KEY, JSON.stringify([...mutedRooms]));
    } catch {}
  }, [mutedRooms]);

  const toggleMuteAll = useCallback(() => setMuteAll((m) => !m), []);

  const toggleRoomMute = useCallback((roomId: string) => {
    setMutedRooms((prev) => {
      const next = new Set(prev);
      next.has(roomId) ? next.delete(roomId) : next.add(roomId);
      return next;
    });
  }, []);

  const isMuted = useCallback(
    (roomId?: string) => computeIsMuted(muteAll, mutedRooms, roomId),
    [muteAll, mutedRooms],
  );

  return { muteAll, mutedRooms, toggleMuteAll, toggleRoomMute, isMuted };
}
