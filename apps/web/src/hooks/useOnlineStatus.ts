import { useEffect, useState } from 'react';

/**
 * Tracks navigator.onLine and emits updates when connectivity changes.
 * LIFF runs inside LINE's in-app browser where mobile data + WiFi handoffs
 * are common — a failing poll is usually a dropped connection, not a dead
 * server, and the recovery UI should reflect that.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
