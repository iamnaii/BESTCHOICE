import { encryptPII, decryptPII } from '../utils/crypto.util';
import { hashPII } from '../utils/pii.util';
import {
  PhoneCrypto,
  RepairRow,
  MAX_MEMBERS_PER_LINE,
  assessKeySafety,
  classifyOrigin,
  formatDuplicateGroupLines,
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
      assessKeySafety({ decryptFailedColumns: 0, withCiphertext: 100, saltSuspect: 0, consistentWithHash: 100 }),
    ).toEqual([]);
  });

  it('ถอดไม่ออกหลายแถว → หยุด', () => {
    expect(
      assessKeySafety({ decryptFailedColumns: 50, withCiphertext: 100, saltSuspect: 0, consistentWithHash: 0 }),
    ).toHaveLength(1);
  });

  it('ถอดไม่ออกแถวเดียวในหลายพัน → ข้ามแถวนั้นได้ ไม่หยุดทั้งงาน', () => {
    expect(
      assessKeySafety({ decryptFailedColumns: 1, withCiphertext: 5000, saltSuspect: 0, consistentWithHash: 5000 }),
    ).toEqual([]);
  });

  it('salt ผิด (ciphertext ตรงแต่ hash ไม่ตรงเกือบทั้งหมด) → หยุด', () => {
    expect(
      assessKeySafety({ decryptFailedColumns: 0, withCiphertext: 100, saltSuspect: 90, consistentWithHash: 100 }),
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

describe('ด่านกุญแจนับหน่วยเดียวกัน (คอลัมน์ ciphertext) — ฐานเล็ก', () => {
  it('3 แถวมีทั้งเบอร์หลัก+สำรองเข้ารหัสด้วยกุญแจอื่น → 6/6 คอลัมน์ถอดไม่ออก → หยุด', () => {
    const plans = ['0811111111', '0822222222', '0833333333'].map((p, i) =>
      planPhoneRepair(
        row({
          id: `k-${i}`,
          phone: p,
          phoneEncrypted: encryptPII(p, OTHER_KEY),
          phoneSecondary: '0899999999',
          phoneSecondaryEncrypted: encryptPII('0899999999', OTHER_KEY),
        }),
        crypto,
      ),
    );
    expect(plans.map((p) => p.decryptFailedColumns)).toEqual([2, 2, 2]);
    const stats = {
      decryptFailedColumns: plans.reduce((a, p) => a + p.decryptFailedColumns, 0),
      withCiphertext: plans.reduce((a, p) => a + p.ciphertextCount, 0),
      saltSuspect: 0,
      consistentWithHash: 0,
    };
    expect(stats).toMatchObject({ decryptFailedColumns: 6, withCiphertext: 6 });
    expect(assessKeySafety(stats)).toHaveLength(1);
  });
});

describe('phone_hash เก็บ plaintext (ผู้เขียนรุ่นเก่าไม่มี salt)', () => {
  it('ซ่อมเป็น STALE · นับ hashPlaintextLeak · ไม่ใช่สัญญาณ salt ผิด', () => {
    const plan = planPhoneRepair(row({ phoneHash: '0812345678' }), crypto);
    expect(plan.hashPlaintextLeak).toBe(true);
    expect(plan.saltSuspect).toBe(false);
    expect(plan.primary?.hashFix).toBe('STALE');
    expect(plan.needsWrite).toBe(true);
  });

  it('plaintext รูปแบบเดิม (มีขีด) ใน hash ก็นับเป็น leak', () => {
    const raw = '081-234 5678';
    const plan = planPhoneRepair(
      row({ phone: raw, phoneHash: raw, phoneEncrypted: encryptPII(raw, KEY) }),
      crypto,
    );
    expect(plan.hashPlaintextLeak).toBe(true);
    expect(plan.saltSuspect).toBe(false);
  });

  it('ร้อยแถวที่ hash เป็น plaintext ไม่ทำให้ด่าน salt หยุด', () => {
    const plans = Array.from({ length: 100 }, (_, i) => {
      const p = `08100000${String(i).padStart(2, '0')}`;
      return planPhoneRepair(row({ phone: p, phoneHash: p, phoneEncrypted: encryptPII(p, KEY) }), crypto);
    });
    expect(
      assessKeySafety({
        decryptFailedColumns: 0,
        withCiphertext: 100,
        saltSuspect: plans.filter((p) => p.saltSuspect).length,
        consistentWithHash: plans.filter((p) => p.consistentWithHash).length,
      }),
    ).toEqual([]);
  });
});

describe('displayChanged — เบอร์บนหน้าจอจะเปลี่ยนหลัง APPLY', () => {
  it('ciphertext ค้างของอีกเบอร์ → true', () => {
    const plan = planPhoneRepair(row({ phoneEncrypted: encryptPII('0899999999', KEY) }), crypto);
    expect(plan.displayChanged).toBe(true);
  });

  it('ciphertext ต่างแค่รูปแบบ → false', () => {
    const plan = planPhoneRepair(row({ phoneEncrypted: encryptPII('+66812345678', KEY) }), crypto);
    expect(plan.primary?.encryptFix).toBe('STALE');
    expect(plan.displayChanged).toBe(false);
  });

  it('ไม่มี ciphertext / plaintext อยู่ในคอลัมน์ ciphertext → false (หน้าจอแสดงคอลัมน์ phone อยู่แล้ว)', () => {
    expect(planPhoneRepair(row({ phoneEncrypted: null }), crypto).displayChanged).toBe(false);
    expect(planPhoneRepair(row({ phoneEncrypted: '0899999999' }), crypto).displayChanged).toBe(false);
  });
});

describe('formatDuplicateGroupLines — กลุ่มใหญ่แตกเป็นหลายบรรทัด', () => {
  const member = (i: number) => ({
    id: `id-${i}`,
    origin: 'OTHER' as const,
    acquisitionSource: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    hashOnly: false,
    contracts: 0,
    sales: 0,
    blocking: {},
    blockingTotal: 0,
    chatRooms: 0,
  });

  it('กลุ่มเล็ก = บรรทัดเดียวรูปเดิม · กลุ่มใหญ่ = part ละไม่เกิน MAX_MEMBERS_PER_LINE คน สมาชิกครบ', () => {
    const big = Array.from({ length: MAX_MEMBERS_PER_LINE * 2 + 1 }, (_, i) => member(i));
    const lines = formatDuplicateGroupLines([
      { customerIds: ['id-a', 'id-b'], hasBotOrChat: false, members: [member(0), member(1)] },
      { customerIds: big.map((m) => m.id), hasBotOrChat: true, members: big },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('DUPLICATE_GROUP 1/2 {');
    expect(lines[1]).toContain('DUPLICATE_GROUP 2/2 part 1/3 {');
    const parts = lines.slice(1).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
    expect(parts.every((p) => p.oversized && p.memberCount === big.length)).toBe(true);
    expect(parts.every((p) => p.members.length <= MAX_MEMBERS_PER_LINE)).toBe(true);
    expect(parts.flatMap((p) => p.customerIds)).toEqual(big.map((m) => m.id));
  });
});
