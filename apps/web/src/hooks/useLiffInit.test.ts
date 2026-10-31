import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { buildLineLoginAuthorizeUrl, useLiffInit } from './useLiffInit';

const setToken = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', () => ({
  setLiffIdToken: (...args: unknown[]) => setToken(...args),
  liffApi: { post: (...args: unknown[]) => post(...args) },
}));
vi.mock('@line/liff', () => ({ default: { init: vi.fn(), isLoggedIn: () => false } }));

const key = 'bcp_liff_session_v1';
/** Task 21 I-A — nonce ของแท็บที่เริ่ม LINE Login (sessionStorage) */
const NONCE_KEY = 'bc_ll_nonce';
const RETRY_KEY = 'bc_ll_retry_at';
const TAB_NONCE = 'tab-nonce_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const rejected = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

beforeEach(() => {
  setToken.mockReset();
  post.mockReset();
  sessionStorage.clear();
  sessionStorage.setItem(
    key,
    JSON.stringify({
      lineId: 'old-user',
      idToken: 'old-token',
      profile: { userId: 'old-user', displayName: 'เดิม' },
      cachedAt: Date.now(),
    }),
  );
  window.history.replaceState({}, '', '/liff/contract');
});

it('uses the new callback identity ahead of an earlier account cached in the same tab — identity from the verified token, not the query', async () => {
  sessionStorage.setItem(NONCE_KEY, TAB_NONCE);
  post.mockResolvedValue({
    data: {
      lineUserId: 'U-verified',
      displayName: 'ตัวจริง',
      pictureUrl: 'https://profile.example/p',
    },
  });
  window.history.replaceState(
    {},
    '',
    '/liff/contract?line_login=true&line_user_id=U-spoofed&line_display_name=ปลอม#id_token=new-token',
  );
  const { result } = renderHook(useLiffInit);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(post).toHaveBeenCalledWith('/line-oa/line-login/verify', {
    idToken: 'new-token',
    nonce: TAB_NONCE,
  });
  expect(result.current.lineId).toBe('U-verified');
  expect(result.current.profile).toEqual({
    userId: 'U-verified',
    displayName: 'ตัวจริง',
    pictureUrl: 'https://profile.example/p',
  });
  expect(setToken).toHaveBeenLastCalledWith('new-token');
  expect(sessionStorage.getItem(NONCE_KEY)).toBeNull(); // ใช้ได้ครั้งเดียว
  expect(JSON.parse(sessionStorage.getItem(key) as string).lineId).toBe('U-verified');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
});

describe('I-A: an id_token carried by the page URL is accepted only for the tab that started the login', () => {
  it('ignores and clears a token planted in a link when this tab never started a login — and starts a fresh login', async () => {
    sessionStorage.removeItem(key);
    window.history.replaceState(
      {},
      '',
      '/liff/finance-verify?line_login=true&line_user_id=U-attacker&line_display_name=BESTCHOICE%20ยืนยันตัวตน&line_picture=https%3A%2F%2Fevil%2Flogo#id_token=attacker-token',
    );
    const { result } = renderHook(useLiffInit);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(post).not.toHaveBeenCalled();
    expect(result.current.lineId).toBe('');
    expect(result.current.profile).toBeNull();
    expect(setToken).not.toHaveBeenCalledWith('attacker-token');
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    // แท็บนี้เริ่มล็อกอินของตัวเอง (nonce ใหม่) — ในแอป LINE เป็นการล็อกอินอัตโนมัติเงียบ ๆ
    expect(sessionStorage.getItem(NONCE_KEY)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects a token the API says was minted for another nonce (attacker callback link) and restarts once', async () => {
    sessionStorage.setItem(NONCE_KEY, TAB_NONCE);
    post.mockRejectedValue(rejected(401));
    window.history.replaceState(
      {},
      '',
      '/liff/finance-verify?line_login=true#id_token=attacker-token',
    );
    const { result } = renderHook(useLiffInit);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lineId).toBe('');
    expect(setToken).not.toHaveBeenCalledWith('attacker-token');
    const fresh = sessionStorage.getItem(NONCE_KEY);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(TAB_NONCE);
    expect(result.current.error).toBeNull();
  });

  it('a second rejected round in the same tab shows an error instead of looping', async () => {
    sessionStorage.removeItem(key);
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    window.history.replaceState(
      {},
      '',
      '/liff/finance-verify?line_login=true#id_token=attacker-token',
    );
    const { result } = renderHook(useLiffInit);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lineId).toBe('');
    expect(result.current.error).toContain('เปิดลิงก์ใหม่จากแชท LINE');
    expect(sessionStorage.getItem(NONCE_KEY)).toBeNull(); // ไม่เริ่มล็อกอินอีก
  });

  it('API unreachable → asks to try again (no identity, no silent re-login)', async () => {
    sessionStorage.setItem(NONCE_KEY, TAB_NONCE);
    post.mockRejectedValue(rejected(503));
    window.history.replaceState({}, '', '/liff/contract?line_login=true#id_token=new-token');
    const { result } = renderHook(useLiffInit);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lineId).toBe('');
    expect(result.current.error).toContain('ลองใหม่');
    expect(setToken).not.toHaveBeenCalledWith('new-token');
    expect(sessionStorage.getItem(NONCE_KEY)).toBeNull();
  });

  it('StrictMode double effect shares the one verification (no second login, no lost identity)', async () => {
    sessionStorage.setItem(NONCE_KEY, TAB_NONCE);
    post.mockResolvedValue({ data: { lineUserId: 'U-verified', displayName: 'ตัวจริง' } });
    window.history.replaceState({}, '', '/liff/finance-verify?line_login=true#id_token=new-token');
    const { result } = renderHook(useLiffInit, { wrapper: StrictMode });
    await waitFor(() => expect(result.current.lineId).toBe('U-verified'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(NONCE_KEY)).toBeNull(); // ไม่ได้เริ่มล็อกอินรอบใหม่
    expect(result.current.error).toBeNull();
  });

  it('the LINE Login start URL carries the tab nonce and the return path', () => {
    const url = new URL(
      buildLineLoginAuthorizeUrl(
        'https://web.example',
        '/api/admin',
        '/liff/finance-verify?src=shop',
        TAB_NONCE,
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://web.example/api/admin/line-oa/line-login/authorize',
    );
    expect(url.searchParams.get('returnPath')).toBe('/liff/finance-verify?src=shop');
    expect(url.searchParams.get('nonce')).toBe(TAB_NONCE);
    expect(
      new URL(
        buildLineLoginAuthorizeUrl(
          'https://web.example',
          'https://api.example/api',
          '/liff/contract',
          TAB_NONCE,
        ),
      ).origin,
    ).toBe('https://api.example');
  });
});

it('does not silently use the prior account when LINE login was cancelled', async () => {
  window.history.replaceState({}, '', '/liff/contract?login_error=true');
  const { result } = renderHook(useLiffInit);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain('ไม่สามารถเข้าสู่ระบบ LINE');
  expect(result.current.lineId).toBe('');
  expect(sessionStorage.getItem(key)).toBeNull();
});
it('continues reusing the cache on normal navigation', async () => {
  const { result } = renderHook(useLiffInit);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.lineId).toBe('old-user');
});
