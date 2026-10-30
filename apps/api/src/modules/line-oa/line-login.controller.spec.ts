import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { LineLoginController } from './line-login.controller';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 20 C2 — LINE Login callback ต้องไม่ redirect ออกนอกโดเมนเว็บ (open redirect ที่พา `id_token`
 * ของเหยื่อไปให้ผู้โจมตี). เดิมต่อสตริง `${FRONTEND_URL}${returnPath}` ⇒
 * `'https://web.example' + '@evil.example/'` = host `evil.example`.
 */
const FRONTEND = 'https://web.example';
const API = 'https://api.example';

function makeController(frontendUrl = FRONTEND): LineLoginController {
  const values: Record<string, string> = {
    LINE_LOGIN_CHANNEL_ID: '2009442540',
    LINE_LOGIN_CHANNEL_SECRET: 'secret',
    FRONTEND_URL: frontendUrl,
    API_BASE_URL: API,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new LineLoginController(config);
}

function makeRes(): { res: Response; redirect: jest.Mock; status: jest.Mock; send: jest.Mock } {
  const redirect = jest.fn();
  const send = jest.fn();
  const status = jest.fn(() => ({ send }));
  return { res: { redirect, status } as unknown as Response, redirect, status, send };
}

/** state ที่ LINE ส่งกลับ = ค่าที่ authorize ใส่ไว้ (encodeURIComponent ของ path) */
const stateOf = (path: string) => encodeURIComponent(path);

const MALICIOUS = [
  '@evil.example/',
  '@evil.example/liff/contract',
  '.evil.example/x',
  '//evil.example/x',
  '/\\evil.example/x',
  '\\\\evil.example/x',
  'https://evil.example/x',
  'javascript:alert(1)',
  '/\t/evil.example/x',
  ':8080@evil.example/',
  '',
  // fix round 1 M2: dot-segment ที่ normalize แล้วกลายเป็น `//evil` + path นอก allowlist (`/liff/`, `/pay/`)
  '/..//evil.example/x',
  '/liff/../..//evil.example/x',
  '/api/line-oa/x',
  '/settings',
];

describe('LineLoginController — returnPath must stay on the frontend origin (C2)', () => {
  const okFetch = () =>
    jest.fn(async (url: string) => {
      if (url.includes('/oauth2/v2.1/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'AT',
            id_token: 'VICTIM_ID_TOKEN',
            token_type: 'Bearer',
          }),
        };
      }
      return { ok: true, json: async () => ({ userId: 'U_victim', displayName: 'Victim' }) };
    });

  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = okFetch() as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each(MALICIOUS)(
    'callback success with state %j → id_token stays on the frontend origin',
    async (path) => {
      const ctl = makeController();
      const { res, redirect } = makeRes();
      await ctl.callback(res, 'CODE', stateOf(path));
      expect(redirect).toHaveBeenCalledTimes(1);
      const target = new URL(redirect.mock.calls[0][0] as string);
      expect(target.origin).toBe(FRONTEND);
      expect(target.pathname).toBe('/liff/contract');
      expect(target.hash).toContain('id_token=');
    },
  );

  it.each(MALICIOUS)(
    'callback error with state %j → login_error redirect stays on origin',
    async (path) => {
      const ctl = makeController();
      const { res, redirect } = makeRes();
      await ctl.callback(res, undefined, stateOf(path), 'access_denied');
      const target = new URL(redirect.mock.calls[0][0] as string);
      expect(target.origin).toBe(FRONTEND);
      expect(target.pathname).toBe('/liff/contract');
      expect(target.searchParams.get('login_error')).toBe('true');
    },
  );

  it('callback with a malformed (undecodable) state falls back instead of throwing', async () => {
    const ctl = makeController();
    const { res, redirect } = makeRes();
    await ctl.callback(res, undefined, '%E0%A4%A', 'access_denied');
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.origin).toBe(FRONTEND);
    expect(target.pathname).toBe('/liff/contract');
  });

  it('legit relative paths (with query) are preserved', async () => {
    const ctl = makeController();
    const { res, redirect } = makeRes();
    await ctl.callback(res, 'CODE', stateOf('/liff/finance-verify?src=shop'));
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.origin).toBe(FRONTEND);
    expect(target.pathname).toBe('/liff/finance-verify');
    expect(target.searchParams.get('src')).toBe('shop');
    expect(target.searchParams.get('line_login')).toBe('true');
    expect(target.searchParams.get('line_user_id')).toBe('U_victim');
    expect(target.hash).toBe(`#id_token=${encodeURIComponent('VICTIM_ID_TOKEN')}`);
  });

  it('error redirect keeps an existing query string well-formed', async () => {
    const ctl = makeController();
    const { res, redirect } = makeRes();
    await ctl.callback(res, undefined, stateOf('/pay/abc?x=1'), 'access_denied');
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.pathname).toBe('/pay/abc');
    expect(target.searchParams.get('x')).toBe('1');
    expect(target.searchParams.get('login_error')).toBe('true');
  });

  it.each(MALICIOUS)('authorize with returnPath %j puts only a safe path into state', (path) => {
    const ctl = makeController();
    const { res, redirect } = makeRes();
    ctl.authorize(res, path);
    const lineUrl = new URL(redirect.mock.calls[0][0] as string);
    expect(lineUrl.origin).toBe('https://access.line.me');
    expect(decodeURIComponent(lineUrl.searchParams.get('state') as string)).toBe('/liff/contract');
  });

  it('authorize keeps a legit returnPath', () => {
    const ctl = makeController();
    const { res, redirect } = makeRes();
    ctl.authorize(res, '/liff/finance-verify');
    const lineUrl = new URL(redirect.mock.calls[0][0] as string);
    expect(decodeURIComponent(lineUrl.searchParams.get('state') as string)).toBe(
      '/liff/finance-verify',
    );
  });

  // fix round 1 M3 — FRONTEND_URL บน prod เป็นรายการ CORS คั่น comma ได้ (app.setup.ts ใช้แบบนั้น)
  it('FRONTEND_URL as a comma list → redirects to the first origin', async () => {
    const ctl = makeController('https://web.example, https://admin.example');
    const { res, redirect } = makeRes();
    await ctl.callback(res, 'CODE', stateOf('/liff/finance-verify'));
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.origin).toBe(FRONTEND);
    expect(target.pathname).toBe('/liff/finance-verify');
  });

  it('unparseable FRONTEND_URL → the error path answers 500 instead of throwing', async () => {
    const ctl = makeController('not a url');
    const { res, redirect, status } = makeRes();
    await expect(ctl.callback(res, undefined, undefined, 'access_denied')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
  });
});
