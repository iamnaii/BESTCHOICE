import { ArgumentsHost, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/**
 * DOC-05 (#1564) — the filter rebuilds every error body and used to drop the
 * `errors` array a 4xx carries (other-income rule failures, V9 self-approval),
 * so the web could never name the failing rule. 5xx bodies stay minimal.
 */
describe('SentryExceptionFilter — response shape', () => {
  const run = (exception: unknown, nodeEnv?: string) => {
    const json = jest.fn<void, [Record<string, unknown>]>();
    const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ url: '/api/x', method: 'POST', user: undefined }) }) } as unknown as ArgumentsHost;
    const previous = process.env.NODE_ENV;
    if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
    try {
      new SentryExceptionFilter().catch(exception, host);
    } finally {
      process.env.NODE_ENV = previous;
    }
    return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] as Record<string, unknown> };
  };

  it('keeps the errors array of a 4xx so the client can name the failing rule', () => {
    const { status, body } = run(new BadRequestException({ message: 'ไม่ผ่านการตรวจสอบก่อน POST', errors: [{ rule: 'V15', msg: 'ดอกเบี้ยเงินฝากต้องไม่มี VAT' }] }));
    expect(status).toBe(400);
    expect(body).toMatchObject({ statusCode: 400, message: 'ไม่ผ่านการตรวจสอบก่อน POST', errors: [{ rule: 'V15', msg: 'ดอกเบี้ยเงินฝากต้องไม่มี VAT' }] });
    expect(typeof body.timestamp).toBe('string');
  });

  it('keeps string messages and the Nest error name for plain exceptions', () => {
    const { status, body } = run(new ForbiddenException('ไม่มีสิทธิ์ดำเนินการรายการบัญชีประเภทนี้'));
    expect(status).toBe(403);
    expect(body).toMatchObject({ message: 'ไม่มีสิทธิ์ดำเนินการรายการบัญชีประเภทนี้', error: 'Forbidden' });
    expect(body).not.toHaveProperty('errors');
  });

  it('never attaches details to a 5xx and hides the message in production', () => {
    const { status, body } = run(new InternalServerErrorException({ message: 'stack detail', errors: [{ rule: 'X' }] }), 'production');
    expect(status).toBe(500);
    expect(body).not.toHaveProperty('errors');
    expect(body.message).toBe('เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง');
  });
});
