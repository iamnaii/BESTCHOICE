import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { encryptPII } from '../../utils/crypto.util';
import { IntegrationConfigService } from './integration-config.service';
import { IntegrationsService } from './integrations.service';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
// AuditService pulls in @sentry/nestjs, which needs the real @sentry/node mocked away above.
jest.mock('../audit/audit.service', () => ({ AuditService: class AuditService {} }));

/**
 * Review M-2: the "ทดสอบการเชื่อมต่อ" buttons must resolve credentials exactly
 * like runtime (`IntegrationConfigService.getValue`): DB row → env only when
 * there is no usable row → default. A row that exists but cannot be decrypted
 * is "not configured" at runtime, so the test must not fall back to the env
 * var and report success while every real call is off.
 *
 * Keys, tokens and env values are test-only fixtures.
 */
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

function serviceWith(rows: Record<string, string>, key: string | undefined) {
  const live = (k: string) => (k in rows ? { key: k, value: rows[k], deletedAt: null } : null);
  const prisma = {
    systemConfig: {
      findFirst: jest.fn(async ({ where }: { where: { key: string } }) => live(where.key)),
      findMany: jest.fn(async () => []),
    },
  };
  const config = {
    get: jest.fn((name: string) => (name === 'INTEGRATION_ENCRYPTION_KEY' ? key : undefined)),
  } as unknown as ConfigService;
  return new IntegrationsService(new IntegrationConfigService(prisma as never, config), {
    log: jest.fn(),
  } as never);
}

const enc = (value: string) => encryptPII(value, KEY_A);

/** integration → (stored rows with the sensitive field(s) encrypted under KEY_A, env that would "work") */
const CASES: Array<[string, Record<string, string>, Record<string, string>]> = [
  [
    'facebook',
    { 'integration.facebook.pageAccessToken': enc('test-only-fb-token') },
    { FB_PAGE_ACCESS_TOKEN: 'test-only-env-fb-token' },
  ],
  [
    'paysolutions',
    {
      'integration.paysolutions.merchantId': 'test-only-merchant',
      'integration.paysolutions.secretKey': enc('test-only-ps-secret'),
      'integration.paysolutions.apiKey': enc('test-only-ps-api-key'),
    },
    {
      PAYSOLUTIONS_SECRET_KEY: 'test-only-env-ps-secret',
      PAYSOLUTIONS_API_KEY: 'test-only-env-ps-key',
    },
  ],
  [
    'peak',
    {
      'integration.peak.userToken': enc('test-only-peak-user'),
      'integration.peak.connectId': 'test-only-connect',
      'integration.peak.secretKey': enc('test-only-peak-secret'),
    },
    { PEAK_USER_TOKEN: 'test-only-env-peak-user', PEAK_SECRET_KEY: 'test-only-env-peak-secret' },
  ],
  [
    'mdm',
    { 'integration.mdm.apiKey': enc('test-only-mdm-key') },
    { MDM_API_KEY: 'test-only-env-mdm-key' },
  ],
  [
    'sms',
    {
      'integration.sms.apiKey': enc('test-only-sms-key'),
      'integration.sms.apiSecret': enc('test-only-sms-secret'),
    },
    { SMS_API_KEY: 'test-only-env-sms-key', SMS_API_SECRET: 'test-only-env-sms-secret' },
  ],
  [
    'claude-ai',
    { 'integration.claude-ai.apiKey': enc('test-only-anthropic-key') },
    { ANTHROPIC_API_KEY: 'test-only-env-anthropic-key' },
  ],
  [
    'email',
    {
      'integration.email.host': 'smtp.test.invalid',
      'integration.email.user': 'test-only-user',
      'integration.email.pass': enc('test-only-smtp-pass'),
    },
    { SMTP_PASS: 'test-only-env-smtp-pass' },
  ],
];

describe('IntegrationsService.testConnection — same credential resolution as runtime', () => {
  let fetchSpy: jest.SpyInstance;
  const envBefore: Record<string, string | undefined> = {};
  const touchedEnv = new Set(CASES.flatMap(([, , env]) => Object.keys(env)));

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('test-only: network disabled'));
    for (const name of touchedEnv) {
      envBefore[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const name of touchedEnv) {
      if (envBefore[name] === undefined) delete process.env[name];
      else process.env[name] = envBefore[name];
    }
  });

  it.each(CASES)(
    '%s: stored credential this process cannot decrypt → "not configured", env never used',
    async (integrationKey, rows, env) => {
      Object.assign(process.env, env);
      const service = serviceWith(rows, KEY_B);

      const result = await service.testConnection(integrationKey);

      expect(result.success).toBe(false);
      expect(result.message).toContain('ยังไม่ได้ตั้งค่า');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['facebook', { FB_PAGE_ACCESS_TOKEN: 'test-only-env-fb-token' }, 'graph.facebook.com'],
    ['mdm', { MDM_API_KEY: 'test-only-env-mdm-key' }, '/api/mdm/devices'],
  ])(
    '%s: no row at all → env is still used (runtime behaviour kept)',
    async (key, env, urlPart) => {
      Object.assign(process.env, env);
      const service = serviceWith({}, KEY_B);

      await service.testConnection(key);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain(urlPart);
    },
  );
});
