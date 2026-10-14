import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLiffInit } from './useLiffInit';
const setToken = vi.fn();
vi.mock('@/lib/api', () => ({ setLiffIdToken: (...args: unknown[]) => setToken(...args) }));
vi.mock('@line/liff', () => ({ default: { init: vi.fn(), isLoggedIn: () => false } }));
const key = 'bcp_liff_session_v1';
beforeEach(() => {
  setToken.mockReset();
  sessionStorage.clear();
  sessionStorage.setItem(key, JSON.stringify({ lineId: 'old-user', idToken: 'old-token', profile: { userId: 'old-user', displayName: 'เดิม' }, cachedAt: Date.now() }));
  window.history.replaceState({}, '', '/liff/contract');
});
it('uses the new callback identity ahead of an earlier account cached in the same tab', async () => {
  window.history.replaceState({}, '', '/liff/contract?line_login=true&line_user_id=new-user&line_display_name=ใหม่#id_token=new-token');
  const { result } = renderHook(useLiffInit);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.lineId).toBe('new-user');
  expect(setToken).toHaveBeenLastCalledWith('new-token');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
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
