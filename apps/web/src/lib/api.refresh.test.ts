import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

let refreshStatuses: number[];
let refreshCalls: number;
let retryAfter: string | undefined;
let originalAdapter: typeof axios.defaults.adapter;
const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown) => {
  const response = { config, status, data, statusText: String(status), headers: retryAfter ? { 'retry-after': retryAfter } : {} };
  if (status >= 400) throw new AxiosError('failed', undefined, config, undefined, response);
  return response;
};
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  refreshStatuses = [429, 200]; refreshCalls = 0; retryAfter = undefined;
  window.history.replaceState({}, '', '/contracts');
  originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    if (config.url === '/auth/refresh') {
      refreshCalls++;
      return respond(config, refreshStatuses.shift() ?? 200, { accessToken: 'renewed' });
    }
    return respond(config, config.headers.Authorization === 'Bearer renewed' ? 200 : 401, { ok: true });
  };
});
afterEach(() => { axios.defaults.adapter = originalAdapter; vi.useRealTimers(); });

it('retries a shared 429 refresh once for concurrent requests and replays every original request', async () => {
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  const result = Promise.all(Array.from({ length: 5 }, () => api.get('/private'))).catch(error => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual(expect.arrayContaining([expect.objectContaining({ status: 200 })]));
  expect(refreshCalls).toBe(2);
  expect(getAccessToken()).toBe('renewed');
});

it.each(['5', new Date(Date.now() + 5000).toUTCString()])('honors Retry-After %s before retrying', async header => {
  retryAfter = header;
  const { default: api, setAccessToken } = await import('./api');
  setAccessToken('expired');
  const result = api.get('/private').catch(error => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(refreshCalls).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await result).status).toBe(200);
});

it('retains the token after exhausting rate-limit retries', async () => {
  refreshStatuses = [429, 429, 429];
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  const result = api.get('/private').catch(error => error);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await result).response.status).toBe(429);
  expect(refreshCalls).toBe(3);
  expect(getAccessToken()).toBe('expired');
});

it('does not retry before a long Retry-After or destroy the session', async () => {
  retryAfter = '120';
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  const result = api.get('/private').catch(error => error);
  await vi.advanceTimersByTimeAsync(60000);
  expect((await result).response.status).toBe(429);
  expect(refreshCalls).toBe(1);
  expect(getAccessToken()).toBe('expired');
});

it('does not restore a session logged out during retry', async () => {
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  const result = api.get('/private').catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  setAccessToken(null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeInstanceOf(Error);
  expect(getAccessToken()).toBeNull();
  expect(refreshCalls).toBe(1);
});

it('retains the session on a refresh server error without retrying', async () => {
  refreshStatuses = [503];
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  await api.get('/private').catch(() => undefined);
  expect(getAccessToken()).toBe('expired');
  expect(refreshCalls).toBe(1);
});

it('clears an explicitly unauthorized refresh session', async () => {
  window.history.replaceState({}, '', '/liff/contract');
  refreshStatuses = [401];
  const { default: api, setAccessToken, getAccessToken } = await import('./api');
  setAccessToken('expired');
  await api.get('/private').catch(() => undefined);
  expect(getAccessToken()).toBeNull();
  expect(refreshCalls).toBe(1);
});
