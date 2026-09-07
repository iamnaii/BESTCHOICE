import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom, throwError } from 'rxjs';

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

  it.each([
    'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,QQ==',
    'data:image/heic;base64,QQ==',
    'data:text/plain,private%20document',
    'data:;base64,QQ==',
    'DATA:application/pdf;base64,QQ==',
  ])('มาสก์ data URL โดยไม่จำกัด MIME หรือรูปแบบ encoding: %s', async (file) => {
    const { ctx, handler } = buildContext({ file });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue.file).toBe('[FILE_DATA]');
  });

  it('มาสก์ไฟล์และข้อมูลลับใน object ภายในอาร์เรย์ โดยไม่แก้ request ต้นฉบับ', async () => {
    const body = {
      documents: [{
        label: 'statement',
        file: 'data:application/pdf;base64,QQ==',
        nationalId: '1234567890123',
        connection: { apiToken: 'fixture-token', enabled: true },
      }],
    };
    const original = JSON.parse(JSON.stringify(body));
    const { ctx, handler } = buildContext(body);
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue).toEqual({
      documents: [{
        label: 'statement',
        file: '[FILE_DATA]',
        nationalId: '[REDACTED]',
        connection: { apiToken: '[REDACTED]', enabled: true },
      }],
    });
    expect(body).toEqual(original);
  });

  it('ตรวจอาร์เรย์ซ้อนทุกชั้น และคงค่าธรรมดา null และ container ว่าง', async () => {
    const { ctx, handler } = buildContext({
      groups: [[
        'data:application/pdf;base64,QQ==',
        { files: ['data:image/jpeg;base64,QQ=='], phone: '0800000000' },
        null, false, 0, '', [], {},
      ]],
      metadata: {},
      sourceUrl: 'https://example.test/statement.pdf',
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue).toEqual({
      groups: [[
        '[FILE_DATA]',
        { files: ['[FILE_DATA]'], phone: '[REDACTED]' },
        null, false, 0, '', [], {},
      ]],
      metadata: {},
      sourceUrl: 'https://example.test/statement.pdf',
    });
  });

  it('คงการปิดบังทั้งฟิลด์ที่เป็นข้อมูลลับ แม้มีไฟล์หรืออาร์เรย์ซ้อนอยู่', async () => {
    const { ctx, handler } = buildContext({
      password: 'data:text/plain,private',
      accessToken: [{ file: 'data:application/pdf;base64,QQ==' }],
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue).toEqual({
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
    });
  });

  it('มาสก์ raw base64 ที่ API รับได้ โดยคงค่า null และช่องไฟล์ว่าง', async () => {
    const { ctx, handler } = buildContext({
      idCardPhotoBase64: 'SUQtQ0FSRA==',
      documents: [{ photoBase64: 'UEhPVE8=' }],
      filesBase64: ['U1RBVEVNRU5U', '', null],
      photoBase64: null,
      fileCount: 3,
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue).toEqual({
      idCardPhotoBase64: '[FILE_DATA]',
      documents: [{ photoBase64: '[FILE_DATA]' }],
      filesBase64: ['[FILE_DATA]', '', null],
      photoBase64: null,
      fileCount: 3,
    });
  });

  it('มาสก์ bulk settings ที่เก็บลายเซ็นและ secret ในรูปแบบ key/value', async () => {
    const { ctx, handler } = buildContext({
      items: [
        { key: 'lessor_signature_image', value: 'data:image/png;base64,QQ==' },
        { key: 'bank_api_key', value: 'fixture-key' },
        { key: 'shop-api-key', value: 'fixture-key' },
        { key: 'shop_name', value: 'BESTCHOICE' },
      ],
    });
    await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(audit.log.mock.calls[0][0].newValue.items).toEqual([
      { key: 'lessor_signature_image', value: '[FILE_DATA]' },
      { key: 'bank_api_key', value: '[REDACTED]' },
      { key: 'shop-api-key', value: '[REDACTED]' },
      { key: 'shop_name', value: 'BESTCHOICE' },
    ]);
  });

  it('มาสก์ request ของงานอัปโหลดที่ล้มเหลว และส่ง error เดิมกลับไป', async () => {
    const { ctx } = buildContext({
      filesBase64: ['data:application/pdf;base64,QQ=='],
      documents: [{ file: 'data:image/jpeg;base64,QQ==', bankAccount: '1234567890' }],
    });
    const error = Object.assign(new Error('Cannot read document'), { status: 422 });
    const handler = { handle: () => throwError(() => error) } as unknown as CallHandler;
    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).rejects.toBe(error);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0]).toMatchObject({
      action: 'POST_ERROR',
      newValue: {
        error: 'Cannot read document',
        statusCode: 422,
        body: {
          filesBase64: ['[FILE_DATA]'],
          documents: [{ file: '[FILE_DATA]', bankAccount: '[REDACTED]' }],
        },
      },
    });
  });
});
