import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { LIFF_ID, API_URL } from '@/lib/env';
import { liffApi, setLiffIdToken } from '@/lib/api';

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
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ ...cache, cachedAt: Date.now() }));
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

// ─── Task 21 I-A — LINE Login (เบราว์เซอร์ / in-app browser) ผูก id_token กับแท็บที่เริ่มล็อกอิน ───
//
// เดิมหน้าเว็บเชื่อ `?line_login=true&line_user_id=…&line_display_name=…#id_token=…` จาก URL ตรง ๆ ⇒ ผู้โจมตีส่งลิงก์
// ที่ฝัง id_token ของ LINE ตัวเอง (หรือลิงก์ callback ที่มี code ของตัวเอง) ให้เหยื่อ → เหยื่อทำ OTP ด้วยเบอร์ตัวเอง →
// LINE ของผู้โจมตีถูกผูกกับลูกค้าเหยื่อ. ตอนนี้:
// 1. ก่อนเริ่ม LINE Login สุ่ม nonce เก็บ sessionStorage ของแท็บ แล้วส่งไป authorize → LINE ฝังเป็น claim ใน id_token
// 2. id_token ที่มากับ URL ใช้ได้เฉพาะเมื่อแท็บนี้มี nonce ค้างอยู่ และ API ยืนยันกับ LINE ว่า token ถูกต้อง + claim nonce
//    ตรง (POST line-oa/line-login/verify) — nonce ใช้ครั้งเดียว · ตัวตน (sub/ชื่อ/รูป) มาจาก payload ที่ยืนยันแล้ว ไม่ใช่ query
// 3. ไม่ตรง/ไม่มี nonce = ทิ้ง token ล้าง URL แล้วเริ่มล็อกอินของแท็บนี้ใหม่หนึ่งครั้ง (ในแอป LINE เป็นการล็อกอินอัตโนมัติ)
// ทาง LIFF SDK (`liff.init` ใต้ /liff/contract) ไม่ผ่าน nonce นี้ — SDK อ่าน `#access_token`/`#id_token` จาก URL ได้เองในบางเวอร์ชัน
// (fix round 1 M-1) ⇒ ตัวตนปลอดภัยเพราะ `LiffTokenGuard` ยืนยัน token กับ LINE ทุกคำขอ ไม่ใช่เพราะ SDK ไม่อ่าน URL
const LOGIN_NONCE_KEY = 'bc_ll_nonce';
/** เวลาที่แท็บนี้เริ่มล็อกอินใหม่อัตโนมัติครั้งล่าสุด — กันวนไม่รู้จบ */
const LOGIN_RETRY_KEY = 'bc_ll_retry_at';
const LOGIN_RETRY_WINDOW_MS = 2 * 60 * 1000;
/** query ของ callback (รุ่นเก่าส่ง userId/ชื่อ/รูปมาด้วย — ล้างทิ้งเสมอ ไม่อ่าน) */
const LOGIN_RESULT_PARAMS = ['line_login', 'line_user_id', 'line_display_name', 'line_picture'];

const LOGIN_STORAGE_ERROR =
  'เบราว์เซอร์นี้ไม่อนุญาตให้เก็บข้อมูลชั่วคราว จึงเข้าสู่ระบบ LINE ไม่ได้ — กรุณาเปิดลิงก์นี้ในแอป LINE';
const LOGIN_RETRY_ERROR =
  'ยืนยันการเข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วเปิดลิงก์ใหม่จากแชท LINE';
const LOGIN_VERIFY_UNAVAILABLE = 'ยืนยันการเข้าสู่ระบบ LINE ไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';

/** ตัวตนที่ API ยืนยันจาก id_token แล้ว (`POST line-oa/line-login/verify`) */
interface VerifiedLineLogin {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

type LoginOutcome =
  | { kind: 'session'; session: Omit<SessionCache, 'cachedAt'> }
  | { kind: 'error'; message: string }
  | { kind: 'redirected' };

/**
 * ผลของ callback ที่กำลังยืนยันอยู่ — ใช้ร่วมกันระหว่าง mount ที่ซ้อนกัน (StrictMode ใน dev รัน effect สองรอบ,
 * หน้าที่ remount ระหว่างรอ) เพราะ URL ถูกล้างและ nonce ถูกใช้ไปแล้วตั้งแต่รอบแรก
 */
let inFlightLogin: Promise<LoginOutcome> | null = null;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** สุ่ม nonce (32 ไบต์) เก็บไว้กับแท็บนี้ — เก็บไม่ได้ = null (ห้ามเริ่มล็อกอินแบบไม่มี nonce) */
function createLoginNonce(): string | null {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const nonce = toBase64Url(bytes);
    sessionStorage.setItem(LOGIN_NONCE_KEY, nonce);
    return sessionStorage.getItem(LOGIN_NONCE_KEY) === nonce ? nonce : null;
  } catch {
    return null;
  }
}

/** อ่านแล้วลบทันที — nonce ใช้ได้ครั้งเดียว */
function takeLoginNonce(): string | null {
  try {
    const nonce = sessionStorage.getItem(LOGIN_NONCE_KEY);
    sessionStorage.removeItem(LOGIN_NONCE_KEY);
    return nonce;
  } catch {
    return null;
  }
}

function stripLoginResultFromUrl(): void {
  const cleanUrl = new URL(window.location.href);
  LOGIN_RESULT_PARAMS.forEach((k) => cleanUrl.searchParams.delete(k));
  cleanUrl.hash = '';
  window.history.replaceState({}, '', cleanUrl.toString());
}

function clearLoginRetryMarker(): void {
  try {
    sessionStorage.removeItem(LOGIN_RETRY_KEY);
  } catch {
    // ignore
  }
}

/** เริ่มล็อกอินใหม่อัตโนมัติได้หนึ่งครั้งต่อ 2 นาทีต่อแท็บ — คืนข้อความ error เมื่อเริ่มไม่ได้ */
function restartLineLoginOnce(): string | null {
  try {
    const last = Number(sessionStorage.getItem(LOGIN_RETRY_KEY) || 0);
    if (Date.now() - last < LOGIN_RETRY_WINDOW_MS) return LOGIN_RETRY_ERROR;
    sessionStorage.setItem(LOGIN_RETRY_KEY, String(Date.now()));
  } catch {
    return LOGIN_STORAGE_ERROR;
  }
  return redirectToLineLogin() ? null : LOGIN_STORAGE_ERROR;
}

function isRejectedLogin(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 400 || status === 401;
}

/** callback ของ LINE Login — อ่าน token จาก URL (ล้างทันที) แล้วให้ API ยืนยันกับ nonce ของแท็บก่อนใช้ */
async function completeLineLogin(): Promise<LoginOutcome> {
  const urlIdToken = new URLSearchParams(window.location.hash.slice(1)).get('id_token');
  stripLoginResultFromUrl();
  const expectedNonce = takeLoginNonce();

  const restart = (): LoginOutcome => {
    const message = restartLineLoginOnce();
    return message ? { kind: 'error', message } : { kind: 'redirected' };
  };
  // ไม่ใช่ล็อกอินที่แท็บนี้เริ่ม (ลิงก์ที่ฝัง token ของคนอื่น / ลิงก์ authorize รุ่นเก่าที่ไม่มี nonce)
  if (!urlIdToken || !expectedNonce) return restart();

  let verified: VerifiedLineLogin;
  try {
    const { data } = await liffApi.post<VerifiedLineLogin>('/line-oa/line-login/verify', {
      idToken: urlIdToken,
      nonce: expectedNonce,
    });
    verified = data;
  } catch (err) {
    // 400/401 = token ไม่ใช่ของแท็บนี้ (หรือหมดอายุ) → เริ่มใหม่ · อื่น ๆ = ระบบขัดข้อง ให้ผู้ใช้ลองใหม่เอง
    return isRejectedLogin(err) ? restart() : { kind: 'error', message: LOGIN_VERIFY_UNAVAILABLE };
  }

  clearLoginRetryMarker();
  const session = {
    lineId: verified.lineUserId,
    idToken: urlIdToken,
    profile: {
      userId: verified.lineUserId,
      displayName: verified.displayName,
      pictureUrl: verified.pictureUrl || undefined,
    },
  };
  writeSessionCache(session);
  return { kind: 'session', session };
}

/**
 * Initialize LINE identity — works in both LIFF (LINE app) and regular browsers.
 *
 * Priority:
 * 1. LINE Login callback — a new login supersedes any cached identity, but only
 *    after the API confirms the token carries this tab's nonce (Task 21 I-A)
 * 2. Session cache — reuse identity on ordinary navigation in the same tab
 * 3. LIFF SDK init — inside LINE app
 * 4. Redirect to LINE Login OAuth (with a fresh tab nonce) — browser fallback when LIFF fails
 */
export function useLiffInit(): UseLiffInitResult {
  const [lineId, setLineId] = useState('');
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applySession = (session: Omit<SessionCache, 'cachedAt'>) => {
      if (cancelled) return;
      setLineId(session.lineId);
      setIdToken(session.idToken);
      setLiffIdToken(session.idToken);
      setProfile(session.profile);
    };
    const fail = (message: string) => {
      if (!cancelled) setError(message);
    };
    const startLineLogin = () => {
      if (!redirectToLineLogin()) fail(LOGIN_STORAGE_ERROR);
    };

    async function init() {
      try {
        const params = new URLSearchParams(window.location.search);
        const hasLoginResult =
          params.get('line_login') === 'true' || params.get('login_error') === 'true';
        // A callback may represent a different LINE account. Never let the old
        // cache hide a new identity, a missing token, or a cancelled login.
        if (hasLoginResult) {
          clearLiffSessionCache();
          setLiffIdToken(null);
        }
        if (params.get('line_login') === 'true') {
          const pending = completeLineLogin();
          inFlightLogin = pending;
          void pending
            .finally(() => {
              if (inFlightLogin === pending) inFlightLogin = null;
            })
            .catch(() => undefined); // ผู้ที่ await เองจัดการ error (catch ด้านล่าง)
        }
        if (inFlightLogin) {
          const outcome = await inFlightLogin;
          if (outcome.kind === 'session') applySession(outcome.session);
          else if (outcome.kind === 'error') fail(outcome.message);
          return;
        }

        const cached = hasLoginResult ? null : readSessionCache();
        if (cached) {
          applySession(cached);
          return;
        }

        // ─── Check LINE Login callback params ───
        if (params.get('login_error') === 'true') {
          fail('ไม่สามารถเข้าสู่ระบบ LINE ได้ กรุณาลองใหม่');
          return;
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
            startLineLogin();
            return;
          }

          const p = await liff.getProfile();
          const token = liff.getIDToken();

          if (!token) {
            // LIFF channel missing openid scope or token cached without openid.
            // OAuth flow uses the same LINE channel (2009442540) and yields
            // the same verifiable id_token, so skip the fragile liff.login
            // retry and go straight to OAuth.
            startLineLogin();
            return;
          }

          const session = {
            lineId: p.userId,
            idToken: token,
            profile: { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl },
          };
          writeSessionCache(session);
          applySession(session);
        } else {
          // Either LIFF_ID not configured, or current URL is not under the
          // LIFF endpoint — use LINE Login OAuth (works for any path, same
          // id_token contract as LIFF channel 2009442540).
          startLineLogin();
        }
      } catch {
        // LIFF init failed (not in LINE app, network error, etc.)
        // Fallback: redirect to LINE Login OAuth
        startLineLogin();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return { lineId, idToken, profile, loading, error };
}

/** URL เริ่ม LINE Login ของ API พร้อม returnPath + nonce ของแท็บ (API_URL อาจเป็น path สัมพัทธ์ /api หรือ URL เต็ม) */
export function buildLineLoginAuthorizeUrl(
  origin: string,
  apiUrl: string,
  returnPath: string,
  nonce: string,
): string {
  const base = apiUrl.startsWith('http') ? apiUrl : `${origin}${apiUrl}`;
  const url = new URL(`${base}/line-oa/line-login/authorize`);
  url.searchParams.set('returnPath', returnPath);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

/**
 * Redirect to LINE Login OAuth endpoint (backend handles the flow).
 * Preserves the current path so user returns to the right page.
 * I-A: ต้องเก็บ nonce ของแท็บได้ก่อนเสมอ — เก็บไม่ได้ = ไม่เริ่ม (false) เพราะ token ที่กลับมาจะถูกปฏิเสธอยู่ดี
 */
function redirectToLineLogin(): boolean {
  const nonce = createLoginNonce();
  if (!nonce) return false;
  const returnPath = window.location.pathname + window.location.search;
  window.location.href = buildLineLoginAuthorizeUrl(
    window.location.origin,
    API_URL,
    returnPath,
    nonce,
  );
  return true;
}
