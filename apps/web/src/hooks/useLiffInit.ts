import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { LIFF_ID, API_URL } from '@/lib/env';
import { setLiffIdToken } from '@/lib/api';

interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

interface UseLiffInitResult {
  lineId: string;
  idToken: string | null;
  profile: LiffProfile | null;
  loading: boolean;
  error: string | null;
}

/**
 * Initialize LINE identity — works in both LIFF (LINE app) and regular browsers.
 *
 * Priority:
 * 1. LINE Login callback params (line_login=true in URL) — browser fallback
 * 2. LIFF SDK init — inside LINE app
 * 3. Redirect to LINE Login OAuth — browser fallback when LIFF fails
 */
export function useLiffInit(): UseLiffInitResult {
  const [lineId, setLineId] = useState('');
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // ─── Check LINE Login callback params first ───
        const params = new URLSearchParams(window.location.search);

        if (params.get('login_error') === 'true') {
          if (!cancelled) setError('ไม่สามารถเข้าสู่ระบบ LINE ได้ กรุณาลองใหม่');
          return;
        }

        if (params.get('line_login') === 'true') {
          const userId = params.get('line_user_id');
          const displayName = params.get('line_display_name');
          const pictureUrl = params.get('line_picture');

          if (userId && displayName) {
            // Clean URL — remove login params
            const cleanUrl = new URL(window.location.href);
            ['line_login', 'line_user_id', 'line_display_name', 'line_picture'].forEach(
              (k) => cleanUrl.searchParams.delete(k),
            );
            window.history.replaceState({}, '', cleanUrl.toString());

            // Fetch id_token from one-shot cookie endpoint (httpOnly, not readable from JS)
            let lineIdToken: string | null = null;
            try {
              const base = API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`;
              const tokenRes = await fetch(`${base}/line-oa/line-login/id-token`, {
                credentials: 'include',
              });
              if (tokenRes.ok) {
                const body = (await tokenRes.json()) as { token?: string };
                lineIdToken = body.token ?? null;
              }
            } catch {
              // Cookie missing or network error
            }

            if (!lineIdToken) {
              if (!cancelled) setError('ไม่สามารถรับ ID Token จาก LINE กรุณาปิดหน้านี้แล้วเปิดใหม่จาก LINE OA');
              return;
            }

            if (!cancelled) {
              setLineId(userId);
              setIdToken(lineIdToken);
              setLiffIdToken(lineIdToken);
              setProfile({ userId, displayName, pictureUrl: pictureUrl || undefined });
            }
            return;
          }
        }

        // ─── Try LIFF SDK init ───
        if (LIFF_ID) {
          await liff.init({ liffId: LIFF_ID });

          if (!liff.isLoggedIn()) {
            // Check if we're inside LINE app
            if (liff.isInClient()) {
              liff.login({ redirectUri: window.location.href });
              return;
            }

            // Outside LINE — redirect to LINE Login OAuth as fallback
            redirectToLineLogin();
            return;
          }

          const p = await liff.getProfile();
          const token = liff.getIDToken();

          // No ID token = LIFF channel missing 'openid' scope OR token expired.
          // Without ID token, server can't verify identity — surface a clear error
          // instead of silently letting downstream API calls 401.
          if (!token) {
            if (!cancelled) setError('ไม่สามารถรับ ID Token จาก LINE กรุณาปิดหน้านี้แล้วเปิดใหม่จาก LINE OA');
            return;
          }

          if (!cancelled) {
            setLineId(p.userId);
            setIdToken(token);
            setLiffIdToken(token);
            setProfile({ userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl });
          }
        } else {
          // No LIFF_ID configured — try LINE Login OAuth directly
          redirectToLineLogin();
        }
      } catch {
        // LIFF init failed (not in LINE app, network error, etc.)
        // Fallback: redirect to LINE Login OAuth
        redirectToLineLogin();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return { lineId, idToken, profile, loading, error };
}

/**
 * Redirect to LINE Login OAuth endpoint (backend handles the flow).
 * Preserves the current path so user returns to the right page.
 */
function redirectToLineLogin(): void {
  const returnPath = window.location.pathname + window.location.search;
  // API_URL may be relative (/api) in dev or absolute (https://api.bestchoicephone.app/api) in prod
  const base = API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`;
  const loginUrl = `${base}/line-oa/line-login/authorize?returnPath=${encodeURIComponent(returnPath)}`;
  window.location.href = loginUrl;
}
