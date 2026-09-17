import { customerPhoneLockKey, lockCustomerPhone } from './customer-phone-lock';
import { hashPII } from '../../utils/pii.util';

describe('customer-phone-lock', () => {
  const SALT = 'phone-lock-spec-salt-0123456789abcdef';
  let prevSalt: string | undefined;

  beforeEach(() => {
    prevSalt = process.env.PII_HASH_SALT;
  });
  afterEach(() => {
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = prevSalt;
  });

  it('ไม่มีเบอร์ → ไม่ยิงอะไรเลย', async () => {
    const tx = { $executeRaw: jest.fn() };
    await lockCustomerPhone(tx as never, { hash: jest.fn() }, null);
    await lockCustomerPhone(tx as never, { hash: jest.fn() }, '');
    await lockCustomerPhone(tx as never, { hash: jest.fn() }, undefined);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('คีย์ = hash ของเบอร์ที่ normalize แล้ว — รูปแบบต่างกันได้คีย์เดียวกัน และไม่มีเบอร์จริงในคีย์', () => {
    const pii = { hash: (v: string | null | undefined) => (v ? hashPII(v, SALT) : null) };
    const a = customerPhoneLockKey(pii, '081-234 5678');
    const b = customerPhoneLockKey(pii, '+66812345678');
    expect(a).toBe(`customer-phone:${hashPII('0812345678', SALT)}`);
    expect(b).toBe(a);
    expect(a).not.toContain('0812345678');
  });

  it('pii ไม่ได้ฉีดมา → ใช้ salt จาก env สูตรเดียวกัน · ไม่มี salt → ใช้เบอร์ normalize', () => {
    process.env.PII_HASH_SALT = SALT;
    expect(customerPhoneLockKey(undefined, '0812345678')).toBe(
      `customer-phone:${hashPII('0812345678', SALT)}`,
    );
    delete process.env.PII_HASH_SALT;
    expect(customerPhoneLockKey(undefined, '081-234-5678')).toBe('customer-phone:0812345678');
    expect(customerPhoneLockKey({ hash: () => null }, '081-234-5678')).toBe(
      'customer-phone:0812345678',
    );
  });

  it('ยิง pg_advisory_xact_lock(hashtext(key)) ด้วย $executeRaw บน client ที่ส่งมา', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    await lockCustomerPhone(tx as never, { hash: () => 'abc' }, '0812345678');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, key] = tx.$executeRaw.mock.calls[0];
    expect((strings as string[]).join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))');
    expect(key).toBe('customer-phone:abc');
  });
});
