import { encryptPII, decryptPII } from '../utils/crypto.util';
import { hashPII } from '../utils/pii.util';
import {
  PhoneCrypto,
  RepairRow,
  assessKeySafety,
  classifyOrigin,
  groupDuplicatePhones,
  planPhoneRepair,
} from './repair-customer-phones.cli';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const SALT = 'repair-customer-phones-spec-salt-0123';

const crypto: PhoneCrypto = {
  hash: (v) => hashPII(v, SALT),
  encrypt: (v) => encryptPII(v, KEY),
  decrypt: (v) => decryptPII(v, KEY),
};

function row(over: Partial<RepairRow> = {}): RepairRow {
  const phone = over.phone === undefined ? '0812345678' : over.phone;
  return {
    id: 'c-1',
    phone,
    phoneHash: phone ? hashPII(phone, SALT) : null,
    phoneEncrypted: phone ? encryptPII(phone, KEY) : null,
    phoneSecondary: null,
    phoneSecondaryEncrypted: null,
    ...over,
  };
}

describe('planPhoneRepair — ตัดสินใจต่อแถว (ไม่ต่อ DB)', () => {
  it('แถวที่ครบแล้ว (normalize + hash + ciphertext ตรง) → ไม่ต้องซ่อม', () => {
    const plan = planPhoneRepair(row(), crypto);
    expect(plan.needsWrite).toBe(false);
    expect(plan.primary?.formatChanged).toBe(false);
    expect(plan.primary?.hashFix).toBeNull();
    expect(plan.primary?.encryptFix).toBeNull();
    expect(plan.invalid).toBe(false);
    expect(plan.groupKey).toBe(hashPII('0812345678', SALT));
  });

  it('รูปแบบเบอร์ไม่ normalize → เปลี่ยนรูปแบบ + hash/ciphertext ใหม่ตามเบอร์ใหม่', () => {
    const plan = planPhoneRepair(
      row({ phone: '081-234 5678', phoneHash: null, phoneEncrypted: null }),
      crypto,
    );
    expect(plan.needsWrite).toBe(true);
    expect(plan.primary).toMatchObject({
      to: '0812345678',
      formatChanged: true,
      hashFix: 'FILLED',
      encryptFix: 'FILLED',
    });
    expect(plan.groupKey).toBe(hashPII('0812345678', SALT));
  });

  it('+66 → 0 และ hash เดิมของรูปแบบเก่า = hash ค้าง', () => {
    const plan = planPhoneRepair(
      row({
        phone: '+66812345678',
        phoneHash: hashPII('+66812345678', SALT),
        phoneEncrypted: encryptPII('+66812345678', KEY),
      }),
      crypto,
    );
    expect(plan.primary).toMatchObject({
      to: '0812345678',
      formatChanged: true,
      hashFix: 'STALE',
      encryptFix: 'STALE',
    });
  });

  it('hash/ciphertext ค้างจากบั๊ก skip-tracing (plaintext ใหม่ ciphertext เก่า) → เขียนตาม plaintext', () => {
    const plan = planPhoneRepair(
      row({
        phone: '0899999999',
        phoneHash: hashPII('0811111111', SALT),
        phoneEncrypted: encryptPII('0811111111', KEY),
      }),
      crypto,
    );
    expect(plan.needsWrite).toBe(true);
    expect(plan.primary).toMatchObject({
      to: '0899999999',
      formatChanged: false,
      hashFix: 'STALE',
      encryptFix: 'STALE',
    });
    expect(plan.saltSuspect).toBe(false);
  });

  it('ciphertext ตรงแต่ hash ต่าง = สัญญาณ salt ผิด (นับไว้ให้ด่านหยุด)', () => {
    const plan = planPhoneRepair(
      row({ phoneHash: hashPII('0812345678', 'another-salt-that-is-long-enough-000') }),
      crypto,
    );
    expect(plan.primary?.hashFix).toBe('STALE');
    expect(plan.saltSuspect).toBe(true);
  });

  it('ciphertext ถอดไม่ออก (กุญแจผิด) → ไม่เขียนแถวนี้ และนับ decryptFailed', () => {
    const plan = planPhoneRepair(row({ phoneEncrypted: encryptPII('0812345678', OTHER_KEY) }), crypto);
    expect(plan.decryptFailed).toBe(true);
    expect(plan.needsWrite).toBe(false);
  });

  it('plaintext อยู่ในคอลัมน์ ciphertext (ไม่ใช่รูปแบบเข้ารหัส) → เข้ารหัสใหม่', () => {
    const plan = planPhoneRepair(row({ phoneEncrypted: '0812345678' }), crypto);
    expect(plan.primary?.encryptFix).toBe('STALE');
    expect(plan.decryptFailed).toBe(false);
  });

  it('เบอร์ที่ normalize แล้วไม่ใช่ 0 + 9 หลัก → invalid แต่ยังซ่อม hash/ciphertext ตามปกติ', () => {
    const plan = planPhoneRepair(row({ phone: '12345', phoneHash: null, phoneEncrypted: null }), crypto);
    expect(plan.invalid).toBe(true);
    expect(plan.needsWrite).toBe(true);
    expect(plan.primary).toMatchObject({ to: '12345', hashFix: 'FILLED', encryptFix: 'FILLED' });
  });

  it('เบอร์มีแต่ช่องว่าง → เบอร์ว่าง ล้าง hash/ciphertext · invalid · ไม่เข้ากลุ่มเบอร์ซ้ำ', () => {
    const plan = planPhoneRepair(
      row({ phone: '  - ', phoneHash: 'x', phoneEncrypted: null }),
      crypto,
    );
    expect(plan.primary).toMatchObject({ to: '', formatChanged: true, hashFix: 'STALE' });
    expect(plan.invalid).toBe(true);
    expect(plan.groupKey).toBeNull();
  });

  it('เบอร์สำรอง: normalize + เติม ciphertext · ไม่มีผลกับกลุ่มเบอร์ซ้ำ', () => {
    const plan = planPhoneRepair(
      row({ phoneSecondary: '(089) 000 1111', phoneSecondaryEncrypted: null }),
      crypto,
    );
    expect(plan.needsWrite).toBe(true);
    expect(plan.primary?.formatChanged).toBe(false);
    expect(plan.secondary).toMatchObject({
      to: '0890001111',
      formatChanged: true,
      encryptFix: 'FILLED',
    });
    expect(plan.groupKey).toBe(hashPII('0812345678', SALT));
  });

  it('เบอร์หลักว่าง มีแต่เบอร์สำรอง → ไม่แตะเบอร์หลัก', () => {
    const plan = planPhoneRepair(
      row({
        phone: null,
        phoneSecondary: '0890001111',
        phoneSecondaryEncrypted: encryptPII('0890001111', KEY),
      }),
      crypto,
    );
    expect(plan.primary).toBeNull();
    expect(plan.needsWrite).toBe(false);
    expect(plan.groupKey).toBeNull();
  });

  it('เบอร์สำรองรูปแบบผิด → invalidSecondary (ไม่ใช่ invalid ของเบอร์หลัก)', () => {
    const plan = planPhoneRepair(
      row({ phoneSecondary: '999', phoneSecondaryEncrypted: encryptPII('999', KEY) }),
      crypto,
    );
    expect(plan.invalid).toBe(false);
    expect(plan.invalidSecondary).toBe(true);
  });
});

describe('assessKeySafety — กันกุญแจ/salt ผิดก่อนเขียนจริง', () => {
  it('ไม่มีสัญญาณ → ผ่าน', () => {
    expect(
      assessKeySafety({ decryptFailed: 0, withCiphertext: 100, saltSuspect: 0, consistentWithHash: 100 }),
    ).toEqual([]);
  });

  it('ถอดไม่ออกหลายแถว → หยุด', () => {
    expect(
      assessKeySafety({ decryptFailed: 50, withCiphertext: 100, saltSuspect: 0, consistentWithHash: 0 }),
    ).toHaveLength(1);
  });

  it('ถอดไม่ออกแถวเดียวในหลายพัน → ข้ามแถวนั้นได้ ไม่หยุดทั้งงาน', () => {
    expect(
      assessKeySafety({ decryptFailed: 1, withCiphertext: 5000, saltSuspect: 0, consistentWithHash: 5000 }),
    ).toEqual([]);
  });

  it('salt ผิด (ciphertext ตรงแต่ hash ไม่ตรงเกือบทั้งหมด) → หยุด', () => {
    expect(
      assessKeySafety({ decryptFailed: 0, withCiphertext: 100, saltSuspect: 90, consistentWithHash: 100 }),
    ).toHaveLength(1);
  });
});

describe('classifyOrigin', () => {
  it.each([
    ['AI_CHAT', 'BOT'],
    ['AI_CHAT_RETURN', 'BOT'],
    ['CHAT_FACEBOOK', 'CHAT'],
    ['walk-in', 'OTHER'],
    [null, 'OTHER'],
  ])('%s → %s', (source, expected) => {
    expect(classifyOrigin(source as string | null)).toBe(expected);
  });
});

describe('groupDuplicatePhones — กลุ่มลูกค้าที่ถือเบอร์หลักเดียวกันหลัง normalize', () => {
  const t = (s: string) => new Date(`2026-09-${s}T00:00:00.000Z`);

  it('คืนเฉพาะกลุ่ม ≥ 2 คน · กลุ่มที่มีแถวบอท/แชทมาก่อน · ในกลุ่มเรียงบอท/แชทก่อนแล้วเก่าก่อน', () => {
    const groups = groupDuplicatePhones([
      { id: 's1', groupKey: 'h-staff', acquisitionSource: null, createdAt: t('02') },
      { id: 's2', groupKey: 'h-staff', acquisitionSource: 'walk-in', createdAt: t('01') },
      { id: 'lonely', groupKey: 'h-single', acquisitionSource: null, createdAt: t('01') },
      { id: 'b-real', groupKey: 'h-bot', acquisitionSource: null, createdAt: t('01') },
      { id: 'b-bot', groupKey: 'h-bot', acquisitionSource: 'AI_CHAT', createdAt: t('05') },
      { id: 'nokey', groupKey: null, acquisitionSource: 'AI_CHAT', createdAt: t('01') },
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([
      ['b-bot', 'b-real'],
      ['s2', 's1'],
    ]);
    expect(groups[0].hasBotOrChat).toBe(true);
    expect(groups[1].hasBotOrChat).toBe(false);
    expect(groups[0].members[0].origin).toBe('BOT');
  });

  it('ไม่ส่ง groupKey (hash) ออกมาในผลลัพธ์', () => {
    const groups = groupDuplicatePhones([
      { id: 'a', groupKey: 'secret-hash', acquisitionSource: null, createdAt: t('01') },
      { id: 'b', groupKey: 'secret-hash', acquisitionSource: null, createdAt: t('02') },
    ]);
    expect(JSON.stringify(groups)).not.toContain('secret-hash');
  });
});
