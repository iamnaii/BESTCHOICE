import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';

/**
 * T2-C15: extend SENSITIVE_FIELDS redaction to cover integration secrets
 * (bank API keys, PEAK secret, MDM key, webhook secret, SMS API secret)
 * plus a regex catch-all for `*secret*` / `*apikey*` / `*token*` so the
 * audit log never stores the plaintext value.
 */
describe('AuditInterceptor — T2-C15 SENSITIVE_FIELDS redaction', () => {
  let audit: { log: jest.Mock };
  let interceptor: AuditInterceptor;

  const buildContext = (body: Record<string, unknown>) => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/settings/system-config',
          body,
          user: { id: 'user-1' },
          headers: {},
          ip: '127.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
    const handler = { handle: () => of({ id: 'cfg-1' }) } as unknown as CallHandler;
    return { ctx, handler };
  };

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(audit as unknown as AuditService);
  });

  it('redacts explicit integration secret keys (peakSecretKey, mdmApiKey, webhookSecret, smsApiSecret)', async () => {
    const { ctx, handler } = buildContext({
      peakSecretKey: 'PEAK-xxxx-plaintext',
      mdmApiKey: 'mdm-yyyy',
      webhookSecret: 'wh_zzz',
      smsApiSecret: 'sms_aaa',
      // non-sensitive passes through
      displayName: 'SHOP settings',
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log).toHaveBeenCalledTimes(1);
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue).toMatchObject({
      peakSecretKey: '[REDACTED]',
      mdmApiKey: '[REDACTED]',
      webhookSecret: '[REDACTED]',
      smsApiSecret: '[REDACTED]',
      displayName: 'SHOP settings',
    });
  });

  it('preserves non-sensitive keys exactly', async () => {
    const { ctx, handler } = buildContext({
      companyCode: 'SHOP',
      branchName: 'Ladprao',
      nationalId: '1234567890123', // PII list (existing)
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue.companyCode).toBe('SHOP');
    expect(arg.newValue.branchName).toBe('Ladprao');
    // nationalId is PII — still redacted by pre-existing rule
    expect(arg.newValue.nationalId).toBe('[REDACTED]');
  });

  it('regex redacts unlisted *secret* / *apikey* / *token* shaped keys', async () => {
    const { ctx, handler } = buildContext({
      lineChannelSecret: 'xxxx',
      chatConeApiKey: 'yyyy',
      xeroAccessToken: 'zzzz',
      // pattern must be case-insensitive
      MY_SECRET: 'aaaa',
      publicId: 'keep',
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue.lineChannelSecret).toBe('[REDACTED]');
    expect(arg.newValue.chatConeApiKey).toBe('[REDACTED]');
    expect(arg.newValue.xeroAccessToken).toBe('[REDACTED]');
    expect(arg.newValue.MY_SECRET).toBe('[REDACTED]');
    expect(arg.newValue.publicId).toBe('keep');
  });
});

/**
 * สเตทเม้นธนาคารที่อัปผ่าน /ocr/bank-statement เป็น `data:application/pdf;base64,…`
 * แต่ตัวมาสก์เดิมจับเฉพาะ `data:image/` → ไฟล์การเงินของลูกค้าทั้งใบถูกเขียนลง
 * `audit_logs` ซึ่งมี trigger ห้าม DELETE (migration 20260520300000) = ลบไม่ได้
 */
describe('AuditInterceptor — มาสก์ไฟล์ base64 ทุกชนิด ไม่ใช่แค่รูป', () => {
  let audit: { log: jest.Mock };
  let interceptor: AuditInterceptor;

  const buildContext = (body: Record<string, unknown>) => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/ocr/bank-statement',
          body,
          user: { id: 'user-1' },
          headers: {},
          ip: '127.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
    const handler = { handle: () => of({ ok: true }) } as unknown as CallHandler;
    return { ctx, handler };
  };

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(audit as unknown as AuditService);
  });

  it('มาสก์ PDF base64 ที่อยู่ในฟิลด์สตริงเดี่ยว', async () => {
    const { ctx, handler } = buildContext({
      statementFile: 'data:application/pdf;base64,JVBERi0xLjQKJcfsj6IK',
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue.statementFile).toBe('[FILE_DATA]');
  });

  it('มาสก์ PDF base64 ที่อยู่ในอาร์เรย์ (รูปแบบจริงของ filesBase64)', async () => {
    const { ctx, handler } = buildContext({
      filesBase64: [
        'data:application/pdf;base64,JVBERi0xLjQKJcfsj6IK',
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA',
      ],
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue.filesBase64).toEqual(['[FILE_DATA]', '[FILE_DATA]']);
  });

  it('ไม่แตะสตริงธรรมดาที่ไม่ใช่ data URL', async () => {
    const { ctx, handler } = buildContext({
      bankName: 'กสิกรไทย',
      note: 'data-driven report',
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    const arg = audit.log.mock.calls[0][0];
    expect(arg.newValue.bankName).toBe('กสิกรไทย');
    expect(arg.newValue.note).toBe('data-driven report');
  });
});
