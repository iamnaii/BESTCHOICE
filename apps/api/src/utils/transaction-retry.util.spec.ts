import { Prisma } from '@prisma/client';
import { isRetryablePrismaWriteError, runWithTransactionRetry } from './transaction-retry.util';

describe('financial transaction retry classification', () => {
  it.each([['P2002', undefined, true], ['P2034', undefined, true], ['P2010', '40001', true],
    ['P2010', '40P01', true], ['P2010', '23503', false], ['P2003', undefined, false]])('%s / %s retry=%s', (code, sqlCode, expected) => {
    const error = new Prisma.PrismaClientKnownRequestError('synthetic', { code: String(code), clientVersion: 'test', meta: { code: sqlCode } });
    expect(isRetryablePrismaWriteError(error)).toBe(expected);
  });
  it('never retries unrelated errors by their message', () => {
    expect(isRetryablePrismaWriteError(new Error('40P01'))).toBe(false);
    expect(isRetryablePrismaWriteError(new Error('deadlock detected'))).toBe(false);
  });
  it.each([
    ['ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected", severity: "ERROR", detail: Some("Process 59200 waits for ShareLock on transaction 2477; blocked by process 59203.") }), transient: false })', true],
    ['ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "40001", message: "could not serialize access due to concurrent update" }) })', true],
    ['ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "23503", message: "insert or update violates foreign key constraint" }) })', false],
  ])('unmapped engine error → retry=%s', (message, expected) => {
    const error = new Prisma.PrismaClientUnknownRequestError(`Error occurred during query execution:\n${message}`, { clientVersion: 'test' });
    expect(isRetryablePrismaWriteError(error)).toBe(expected);
  });
  it('recognises the SQLSTATE inside a known error whose code is not P2010', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Error occurred during query execution: ConnectorError(PostgresError { code: "40P01", message: "deadlock detected" })', { code: 'P2023', clientVersion: 'test' });
    expect(isRetryablePrismaWriteError(error)).toBe(true);
  });
});

describe('runWithTransactionRetry (Task 29 fix round 1)', () => {
  const deadlock = () =>
    new Prisma.PrismaClientKnownRequestError('deadlock detected', {
      code: 'P2034',
      clientVersion: 'test',
    });

  it('deadlock แล้วสำเร็จ → ลองทั้งก้อนใหม่และคืนผลรอบที่สำเร็จ', async () => {
    const run = jest.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce('ok');
    await expect(runWithTransactionRetry(run, 3)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ครบจำนวนครั้ง → ส่ง error ล่าสุดต่อ ไม่ลองไม่สิ้นสุด', async () => {
    const run = jest.fn().mockRejectedValue(deadlock());
    await expect(runWithTransactionRetry(run, 3)).rejects.toMatchObject({ code: 'P2034' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('error ที่ลองซ้ำไม่ได้ → ส่งต่อทันที · เงื่อนไขของผู้เรียกเพิ่มได้', async () => {
    const fatal = jest.fn().mockRejectedValue(new Error('validation'));
    await expect(runWithTransactionRetry(fatal, 3)).rejects.toThrow('validation');
    expect(fatal).toHaveBeenCalledTimes(1);
    class Unstable extends Error {}
    const custom = jest.fn().mockRejectedValueOnce(new Unstable()).mockResolvedValueOnce(1);
    await expect(runWithTransactionRetry(custom, 2, (e) => e instanceof Unstable)).resolves.toBe(1);
  });
});
