import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { LIFF_ID } from '@/lib/env';

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

interface UseLiffInitResult {
  lineId: string;
  profile: LiffProfile | null;
  loading: boolean;
  error: string | null;
}

export function useLiffInit(): UseLiffInitResult {
  const [lineId, setLineId] = useState('');
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        if (LIFF_ID) {
          await liff.init({ liffId: LIFF_ID });

          if (!liff.isLoggedIn()) {
            liff.login();
            return;
          }

          const p = await liff.getProfile();
          if (!cancelled) {
            setLineId(p.userId);
            setProfile({ userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl });
          }
        } else {
          // Dev-only fallback: accept lineId from URL
          if (import.meta.env.DEV) {
            const params = new URLSearchParams(window.location.search);
            const qLineId = params.get('lineId');
            if (qLineId) {
              if (!cancelled) setLineId(qLineId);
            } else {
              if (!cancelled) setError('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
            }
          } else {
            if (!cancelled) setError('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('LIFF init error:', err);
        // Dev-only fallback on error
        if (import.meta.env.DEV) {
          const params = new URLSearchParams(window.location.search);
          const qLineId = params.get('lineId');
          if (qLineId) {
            if (!cancelled) setLineId(qLineId);
          } else {
            if (!cancelled) setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
          }
        } else {
          if (!cancelled) setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return { lineId, profile, loading, error };
}
