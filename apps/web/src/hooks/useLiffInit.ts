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
          // Read id_token from query param. Fallback to hash for backward
          // compat if an older backend revision happens to still put it there.
          const lineIdToken =
            params.get('id_token') ||
            new URLSearchParams(window.location.hash.slice(1)).get('id_token');

          if (userId && displayName) {
            // Clean URL — remove login query params AND fragment
            const cleanUrl = new URL(window.location.href);
            ['line_login', 'line_user_id', 'line_display_name', 'line_picture', 'id_token'].forEach(
              (k) => cleanUrl.searchParams.delete(k),
            );
            cleanUrl.hash = '';
            window.history.replaceState({}, '', cleanUrl.toString());

            if (!lineIdToken) {
              if (!cancelled)
                setError('เชื่อม LINE ไม่สำเร็จ (ไม่ได้ ID Token) — กรุณาปิดและเปิดใหม่จาก LINE OA');
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

          // No ID token = LIFF channel missing 'openid' scope OR cached token
          // from a prior login without openid. Try ONCE to force fresh login
          // (clears cached token) — use sessionStorage flag to prevent loop.
          if (!token) {
            const RETRY_KEY = 'liff_idtoken_retry';
            const alreadyRetried = sessionStorage.getItem(RETRY_KEY) === '1';
            if (!alreadyRetried && liff.isInClient()) {
              sessionStorage.setItem(RETRY_KEY, '1');
              try {
                liff.logout();
              } catch {
                // ignore logout errors
              }
              liff.login({ redirectUri: window.location.href });
              return;
            }
            sessionStorage.removeItem(RETRY_KEY);
            if (!cancelled)
              setError(
                'ไม่สามารถรับ ID Token จาก LINE — LIFF channel อาจยังไม่เปิด openid scope กรุณาแจ้งแอดมินเพื่อตรวจสอบ LINE Developers Console',
              );
            return;
          }

          // Success — clear retry flag
          sessionStorage.removeItem('liff_idtoken_retry');

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
