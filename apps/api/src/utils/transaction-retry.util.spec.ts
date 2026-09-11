import { Prisma } from '@prisma/client';
import { isRetryablePrismaWriteError } from './transaction-retry.util';

describe('financial transaction retry classification', () => {
  it.each([['P2002', undefined, true], ['P2034', undefined, true], ['P2010', '40001', true],
    ['P2010', '40P01', true], ['P2010', '23503', false], ['P2003', undefined, false]])('%s / %s retry=%s', (code, sqlCode, expected) => {
    const error = new Prisma.PrismaClientKnownRequestError('synthetic', { code: String(code), clientVersion: 'test', meta: { code: sqlCode } });
    expect(isRetryablePrismaWriteError(error)).toBe(expected);
  });
  it('never retries unrelated errors by their message', () => {
    expect(isRetryablePrismaWriteError(new Error('40P01'))).toBe(false);
  });
});
