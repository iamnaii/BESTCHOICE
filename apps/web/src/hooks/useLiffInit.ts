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

// Session cache — survives SPA navigation within the same tab so navigating
// between LIFF pages (e.g. /liff/contract → /liff/early-payoff) does not
// re-trigger LIFF SDK init or an OAuth round-trip. Cleared when the tab is
// closed; also cleared by the axios 401 handler if the server rejects the
// cached id_token (see lib/api.ts).
//
// A cachedAt timestamp bounds staleness on the client too — LIFF/OAuth
// id_tokens are valid for ~1 hour so we treat entries older than 50 minutes
// as expired and fall through to a fresh login.
const SESSION_CACHE_KEY = 'bcp_liff_session_v1';
const SESSION_CACHE_TTL_MS = 50 * 60 * 1000;

interface SessionCache {
  lineId: string;
  idToken: string;
  profile: LiffProfile;
  cachedAt: number;
}

function readSessionCache(): SessionCache | null {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCache;
    if (!parsed.lineId || !parsed.idToken || !parsed.profile || !parsed.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > SESSION_CACHE_TTL_MS) {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(cache: Omit<SessionCache, 'cachedAt'>): void {
  try {
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ ...cache, cachedAt: Date.now() }),
    );
  } catch {
    // sessionStorage unavailable — fall through; next page will just re-auth
  }
}

/**
 * Invalidate the LIFF session cache. Call from lib/api.ts on 401 so a stale
 * id_token triggers a fresh OAuth round-trip on the next page mount instead
 * of looping through failed API calls, and from future logout UI.
 */
export function clearLiffSessionCache(): void {
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Initialize LINE identity — works in both LIFF (LINE app) and regular browsers.
 *
 * Priority:
 * 1. Session cache — reuse identity set by a prior page in the same tab
 * 2. LINE Login callback params (line_login=true in URL) — browser fallback
 * 3. LIFF SDK init — inside LINE app
 * 4. Redirect to LINE Login OAuth — browser fallback when LIFF fails
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
        // ─── Session cache first — avoids re-auth when navigating between LIFF pages ───
        const cached = readSessionCache();
        if (cached) {
          if (!cancelled) {
            setLineId(cached.lineId);
            setIdToken(cached.idToken);
            setLiffIdToken(cached.idToken);
            setProfile(cached.profile);
          }
          return;
        }

        // ─── Check LINE Login callback params ───
        const params = new URLSearchParams(window.location.search);

        if (params.get('login_error') === 'true') {
          if (!cancelled) setError('ไม่สามารถเข้าสู่ระบบ LINE ได้ กรุณาลองใหม่');
          return;
        }

        if (params.get('line_login') === 'true') {
          const userId = params.get('line_user_id');
          const displayName = params.get('line_display_name');
          const pictureUrl = params.get('line_picture');

          // Read id_token from URL fragment (backend puts it there to avoid
          // WebKit ITP cross-subdomain cookie blocking). Fragment is not sent
          // to server in any HTTP request = no leak in access logs/referrer.
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          const lineIdToken = hashParams.get('id_token');

          if (userId && displayName) {
            // Clean URL — remove login query params AND fragment
            const cleanUrl = new URL(window.location.href);
            ['line_login', 'line_user_id', 'line_display_name', 'line_picture'].forEach(
              (k) => cleanUrl.searchParams.delete(k),
            );
            cleanUrl.hash = '';
            window.history.replaceState({}, '', cleanUrl.toString());

            if (!lineIdToken) {
              if (!cancelled)
                setError('ไม่สามารถรับ ID Token จาก LINE กรุณาปิดหน้านี้แล้วเปิดใหม่จาก LINE OA');
              return;
            }

            const profileValue: LiffProfile = {
              userId,
              displayName,
              pictureUrl: pictureUrl || undefined,
            };
            writeSessionCache({ lineId: userId, idToken: lineIdToken, profile: profileValue });

            if (!cancelled) {
              setLineId(userId);
              setIdToken(lineIdToken);
              setLiffIdToken(lineIdToken);
              setProfile(profileValue);
            }
            return;
          }
        }

        // ─── Try LIFF SDK init (only works when URL is under LIFF endpoint) ───
        // LIFF endpoint URL in LINE Developers Console is /liff/contract —
        // LIFF SDK returns null ID tokens and rejects liff.login() with
        // "redirectUri not under endpoint URL" for any other path. We detect
        // non-endpoint URLs up-front and skip LIFF entirely so the user sees
        // the LINE Login OAuth fallback (same channel 2009442540, same
        // id_token contract) instead of LINE's generic "cannot open page".
        const LIFF_ENDPOINT_PATH = '/liff/contract';
        const isUnderLiffEndpoint =
          window.location.pathname === LIFF_ENDPOINT_PATH ||
          window.location.pathname.startsWith(`${LIFF_ENDPOINT_PATH}/`);

        if (LIFF_ID && isUnderLiffEndpoint) {
          await liff.init({ liffId: LIFF_ID });

          if (!liff.isLoggedIn()) {
            // liff.login() requires redirectUri to be under the LIFF endpoint
            // URL — we're already under it here so this call is safe.
            if (liff.isInClient()) {
              liff.login({ redirectUri: window.location.href });
              return;
            }
            redirectToLineLogin();
            return;
          }

          const p = await liff.getProfile();
          const token = liff.getIDToken();

          if (!token) {
            // LIFF channel missing openid scope or token cached without openid.
            // OAuth flow uses the same LINE channel (2009442540) and yields
            // the same verifiable id_token, so skip the fragile liff.login
            // retry and go straight to OAuth.
            redirectToLineLogin();
            return;
          }

          const profileValue: LiffProfile = {
            userId: p.userId,
            displayName: p.displayName,
            pictureUrl: p.pictureUrl,
          };
          writeSessionCache({ lineId: p.userId, idToken: token, profile: profileValue });

          if (!cancelled) {
            setLineId(p.userId);
            setIdToken(token);
            setLiffIdToken(token);
            setProfile(profileValue);
          }
        } else {
          // Either LIFF_ID not configured, or current URL is not under the
          // LIFF endpoint — use LINE Login OAuth (works for any path, same
          // id_token contract as LIFF channel 2009442540).
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
