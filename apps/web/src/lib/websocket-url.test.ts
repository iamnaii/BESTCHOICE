import { afterEach, describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ apiUrl: '/api/admin' }));
vi.mock('@/lib/env', () => ({ get API_URL() { return config.apiUrl; } }));
import { getWsBaseUrl } from './websocket-url';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); config.apiUrl = '/api/admin'; });

describe('shared chat/PBX WebSocket origin', () => {
  it('preserves absolute API origin precedence over the override', () => {
    config.apiUrl = 'https://api.example.test/api/admin';
    vi.stubEnv('VITE_WS_URL', 'https://override.example.test');
    expect(getWsBaseUrl()).toBe('https://api.example.test');
  });
  it('uses the override for a relative API URL', () => {
    vi.stubEnv('VITE_WS_URL', 'https://override.example.test');
    expect(getWsBaseUrl()).toBe('https://override.example.test');
  });
  it('uses the development backend by default', () => {
    vi.stubEnv('VITE_WS_URL', ''); vi.stubEnv('DEV', true);
    expect(getWsBaseUrl()).toBe('http://localhost:3000');
  });
  it.each([
    ['admin.bestchoicephone.app', 'https://api.bestchoicephone.app'],
    ['bestchoicephone.app', 'https://api.bestchoicephone.app'],
    ['notbestchoicephone.app', 'https://notbestchoicephone.app'],
    ['example.test', 'https://example.test'],
  ])('routes the production host %s', (hostname, expected) => {
    vi.stubEnv('VITE_WS_URL', ''); vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: { hostname, origin: `https://${hostname}` } });
    expect(getWsBaseUrl()).toBe(expected);
  });
});
