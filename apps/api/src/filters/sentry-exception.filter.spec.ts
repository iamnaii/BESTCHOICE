import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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

  /**
   * R47 (QA fix, 2026-09-14) — customer-write.service.ts's duplicate-contact
   * ConflictExceptions carry `existingCustomer` + `field` so the web
   * (CustomerCreateDialog / useOcrFlow) can offer "รวมกับลูกค้าเดิมคนนี้". The
   * rewrite below used to drop both, same class of bug as the `errors` array
   * fixed by DOC-05 above — allow-list them explicitly rather than spreading
   * the whole response (the filter's redaction intent stands).
   */
  it('forwards existingCustomer and field on a 409 so the web can offer to merge with the existing customer', () => {
    const { status, body } = run(
      new ConflictException({
        message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
        existingCustomer: { id: 'c1', name: 'x' },
        field: 'phone',
      }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
      existingCustomer: { id: 'c1', name: 'x' },
      field: 'phone',
    });
  });

  it('still keeps the errors array of a plain 400 object response (regression guard)', () => {
    const { status, body } = run(new BadRequestException({ message: 'bad', errors: [{ rule: 'r', msg: 'm' }] }));
    expect(status).toBe(400);
    expect(body).toMatchObject({ errors: [{ rule: 'r', msg: 'm' }] });
  });

  it('never leaks existingCustomer/field/errors on a 500 and hides the message in production', () => {
    const { status, body } = run(new Error('boom'), 'production');
    expect(status).toBe(500);
    expect(body.message).toBe('เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง');
    expect(body).not.toHaveProperty('existingCustomer');
    expect(body).not.toHaveProperty('field');
    expect(body).not.toHaveProperty('errors');
  });

  it('passes through the message of a string-response HttpException without extra keys', () => {
    const { status, body } = run(new NotFoundException('ไม่พบลูกค้า'));
    expect(status).toBe(404);
    expect(body.message).toBe('ไม่พบลูกค้า');
    expect(body).not.toHaveProperty('existingCustomer');
    expect(body).not.toHaveProperty('field');
    expect(body).not.toHaveProperty('errors');
  });
});
