import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Response } from 'express';
import { VerifyLineLoginDto } from './dto/verify-line-login.dto';
import { LineLoginController } from './line-login.controller';
import { buildBrowserUrl } from '../../utils/line-login.util';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 21 I-A — login CSRF / identity injection ผ่าน LINE Login.
 * หน้าเว็บสุ่ม nonce (เก็บ sessionStorage ของแท็บ) → authorize ส่งต่อให้ LINE (ฝังเป็น claim `nonce` ใน id_token
 * ซึ่งผู้โจมตีแก้ไม่ได้) → ก่อนรับ id_token ที่มากับ URL หน้าเว็บต้องให้ API ยืนยันกับ LINE ว่า token ถูกต้องและ
 * `nonce` ตรงกับค่าของแท็บนี้ · ตัวตน (sub/name/picture) มาจาก token ที่ยืนยันแล้วเท่านั้น ไม่ใช่ query
 */
const CHANNEL = '2009442540';
const NONCE = 'n0nce_of-this-tab_AAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 43+ ตัว base64url แบบที่เว็บสร้าง
const ID_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJVMTIzIn0.c2ln';

function makeController(): LineLoginController {
  const values: Record<string, string> = {
    LINE_LOGIN_CHANNEL_ID: CHANNEL,
    LINE_LOGIN_CHANNEL_SECRET: 'secret',
    FRONTEND_URL: 'https://web.example',
    API_BASE_URL: 'https://api.example',
  };
  return new LineLoginController({ get: (k: string) => values[k] } as unknown as ConfigService);
}

function makeRes(): { res: Response; redirect: jest.Mock } {
  const redirect = jest.fn();
  return { res: { redirect } as unknown as Response, redirect };
}

/** LINE `POST /oauth2/v2.1/verify` ตอบ payload ของ token (หรือ error) */
function lineVerifyReturns(status: number, body: Record<string, unknown>): jest.Mock {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

const VALID_PAYLOAD = {
  iss: 'https://access.line.me',
  sub: 'U_real_owner',
  aud: CHANNEL,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  nonce: NONCE,
  name: 'ลูกค้าจริง',
  picture: 'https://profile.line-scdn.net/real',
};

describe('LineLoginController — OIDC nonce binds the id_token to the tab that started the login (I-A)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('authorize', () => {
    it('forwards the tab nonce to LINE as the OIDC nonce', () => {
      const { res, redirect } = makeRes();
      makeController().authorize(res, '/liff/finance-verify', NONCE);
      const lineUrl = new URL(redirect.mock.calls[0][0] as string);
      expect(lineUrl.origin).toBe('https://access.line.me');
      expect(lineUrl.searchParams.get('nonce')).toBe(NONCE);
    });

    it.each([['short'], ['has space here AAAAAAAAAAAAAAAAAAAA'], ['a'.repeat(200)], [['x', 'y']]])(
      'drops a malformed nonce %j instead of forwarding it',
      (nonce) => {
        const { res, redirect } = makeRes();
        makeController().authorize(res, '/liff/finance-verify', nonce as unknown as string);
        const lineUrl = new URL(redirect.mock.calls[0][0] as string);
        expect(lineUrl.searchParams.has('nonce')).toBe(false);
      },
    );
  });

  describe('callback', () => {
    it('hands back only the id_token — no LINE user id / name / picture in the query (PII + spoofable)', async () => {
      const fetchMock = jest.fn(async (url: string) => {
        if (url.includes('/oauth2/v2.1/token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'AT', id_token: ID_TOKEN, token_type: 'Bearer' }),
          };
        }
        return { ok: true, json: async () => ({ userId: 'U_real_owner', displayName: 'X' }) };
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const { res, redirect } = makeRes();
      await makeController().callback(res, 'CODE', encodeURIComponent('/liff/finance-verify'));

      const target = new URL(redirect.mock.calls[0][0] as string);
      expect(target.pathname).toBe('/liff/finance-verify');
      expect(target.searchParams.get('line_login')).toBe('true');
      expect(target.searchParams.has('line_user_id')).toBe(false);
      expect(target.searchParams.has('line_display_name')).toBe(false);
      expect(target.searchParams.has('line_picture')).toBe(false);
      expect(target.hash).toBe(`#id_token=${encodeURIComponent(ID_TOKEN)}`);
      // ตัวตนอยู่ใน id_token แล้ว — ไม่ต้องเรียก /v2/profile
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
        'https://api.line.me/oauth2/v2.1/token',
      ]);
    });
  });

  describe('verify (redirect path — the page must not accept a URL token without this)', () => {
    it('matching nonce → identity comes from the LINE-verified token payload', async () => {
      const fetchMock = lineVerifyReturns(200, VALID_PAYLOAD);
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).resolves.toEqual({
        lineUserId: 'U_real_owner',
        displayName: 'ลูกค้าจริง',
        pictureUrl: 'https://profile.line-scdn.net/real',
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.line.me/oauth2/v2.1/verify');
      const body = new URLSearchParams(String(init.body));
      expect(body.get('id_token')).toBe(ID_TOKEN);
      expect(body.get('client_id')).toBe(CHANNEL);
      expect(body.get('nonce')).toBe(NONCE); // LINE ตรวจ nonce ด้วย (signature/aud/exp ตามเดิม)
    });

    it('LINE rejects the token (wrong nonce / expired / bad signature) → 401, no identity', async () => {
      global.fetch = lineVerifyReturns(400, {
        error: 'invalid_request',
        error_description: 'Invalid IdToken Nonce.',
      }) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("token minted for another tab's nonce (attacker's own login) → 401 even if LINE accepts it", async () => {
      global.fetch = lineVerifyReturns(200, {
        ...VALID_PAYLOAD,
        sub: 'U_attacker',
        nonce: 'attacker-chosen-nonce-AAAAAAAAAAAAAAAAAAAA',
      }) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('token with no nonce claim (login started outside our page) → 401', async () => {
      const { nonce: _omit, ...withoutNonce } = VALID_PAYLOAD;
      void _omit;
      global.fetch = lineVerifyReturns(200, withoutNonce) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('token issued for another channel → 401', async () => {
      global.fetch = lineVerifyReturns(200, {
        ...VALID_PAYLOAD,
        aud: '1111111111',
      }) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('missing / malformed nonce → 400 without asking LINE', async () => {
      const fetchMock = lineVerifyReturns(200, VALID_PAYLOAD);
      global.fetch = fetchMock as unknown as typeof fetch;
      for (const nonce of [undefined, '', 'short', 'bad nonce with spaces AAAAAAAAAAAAAAAA']) {
        await expect(
          makeController().verify({ idToken: ID_TOKEN, nonce } as unknown as VerifyLineLoginDto),
        ).rejects.toThrow(BadRequestException);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('LINE unreachable → 503 (the page shows "try again", not a silent re-login loop)', async () => {
      global.fetch = jest.fn(async () => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      }) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        ServiceUnavailableException,
      );
      // LINE ตอบ 5xx = ขัดข้อง ไม่ใช่ token ผิด
      global.fetch = lineVerifyReturns(502, {}) as unknown as typeof fetch;
      await expect(makeController().verify({ idToken: ID_TOKEN, nonce: NONCE })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('DTO: idToken and nonce are required and shaped', async () => {
      const errorsOf = async (body: Record<string, unknown>) =>
        (await validate(plainToInstance(VerifyLineLoginDto, body))).map((e) => e.property).sort();
      expect(await errorsOf({ idToken: ID_TOKEN, nonce: NONCE })).toEqual([]);
      expect(await errorsOf({ idToken: ID_TOKEN })).toEqual(['nonce']);
      expect(await errorsOf({ nonce: NONCE })).toEqual(['idToken']);
      expect(await errorsOf({ idToken: 'not a jwt', nonce: 'x' })).toEqual(['idToken', 'nonce']);
    });
  });
});

describe('buildBrowserUrl — bot links open the web page, which starts LINE Login with its own nonce (I-A)', () => {
  const saved = { FRONTEND_URL: process.env.FRONTEND_URL, API_BASE_URL: process.env.API_BASE_URL };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('points at the first FRONTEND_URL origin + the LIFF path (not the API authorize)', () => {
    process.env.FRONTEND_URL = 'https://web.example, https://admin.example';
    process.env.API_BASE_URL = 'https://api.example';
    expect(buildBrowserUrl('/liff/finance-verify')).toBe('https://web.example/liff/finance-verify');
    expect(buildBrowserUrl('/liff/contract')).toBe('https://web.example/liff/contract');
  });

  it('an unsafe path still lands on the default LIFF page of our own origin', () => {
    process.env.FRONTEND_URL = 'https://web.example';
    expect(buildBrowserUrl('//evil.example/x')).toBe('https://web.example/liff/contract');
  });

  it('unusable FRONTEND_URL → falls back to the API authorize link (the page still enforces the nonce)', () => {
    process.env.FRONTEND_URL = 'not a url';
    process.env.API_BASE_URL = 'https://api.example';
    expect(buildBrowserUrl('/liff/finance-verify')).toBe(
      'https://api.example/api/line-oa/line-login/authorize?returnPath=%2Fliff%2Ffinance-verify',
    );
  });
});
