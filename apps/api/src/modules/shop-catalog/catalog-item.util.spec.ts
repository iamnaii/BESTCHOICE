import { deriveUnitTags, deriveDisplayNo, modelRank, gradeRank } from './catalog-item.util';

const NOW = new Date('2026-08-21T00:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe('deriveUnitTags', () => {
  it('ไม่มีอะไรน่าอวด → ไม่มีแท็ก (การ์ดว่างดีกว่าการ์ดโม้)', () => {
    expect(deriveUnitTags({}, NOW)).toEqual([]);
  });

  it('แบตตั้งแต่ 85% ขึ้นไปเท่านั้นที่ได้แท็ก', () => {
    expect(deriveUnitTags({ batteryHealth: 84 }, NOW)).toEqual([]);
    expect(deriveUnitTags({ batteryHealth: 85 }, NOW)).toEqual(['แบต 85%']);
    expect(deriveUnitTags({ batteryHealth: 100 }, NOW)).toEqual(['แบต 100%']);
  });

  it('ประกันต้องเหลือเกิน 90 วันถึงจะขึ้น และนับเป็นเดือน', () => {
    expect(deriveUnitTags({ warrantyExpireDate: daysFromNow(90) }, NOW)).toEqual([]);
    expect(deriveUnitTags({ warrantyExpireDate: daysFromNow(120) }, NOW)).toEqual(['ประกัน 4 ด.']);
  });

  it('ประกันที่ถูกตีว่าหมดอายุแล้ว ไม่ขึ้นแท็กแม้วันที่ยังไม่ถึง', () => {
    expect(
      deriveUnitTags({ warrantyExpireDate: daysFromNow(200), warrantyExpired: true }, NOW),
    ).toEqual([]);
  });

  it('ประกันที่หมดไปแล้วไม่ขึ้นแท็ก', () => {
    expect(deriveUnitTags({ warrantyExpireDate: daysFromNow(-1) }, NOW)).toEqual([]);
  });

  it('เข้าสต๊อกภายใน 7 วันนับเป็นของเข้าใหม่ วันที่ 8 ไม่ใช่แล้ว', () => {
    expect(deriveUnitTags({ stockInDate: daysFromNow(-7) }, NOW)).toEqual(['เข้าใหม่']);
    expect(deriveUnitTags({ stockInDate: daysFromNow(-8) }, NOW)).toEqual([]);
  });

  it('เรียงตามลำดับความสำคัญ: แบต → ประกัน → กล่อง → เข้าใหม่ (การ์ดโชว์แค่ 2 อันแรก)', () => {
    expect(
      deriveUnitTags(
        {
          batteryHealth: 92,
          warrantyExpireDate: daysFromNow(150),
          hasBox: true,
          stockInDate: daysFromNow(-1),
        },
        NOW,
      ),
    ).toEqual(['แบต 92%', 'ประกัน 5 ด.', 'ครบกล่อง', 'เข้าใหม่']);
  });
});

describe('deriveDisplayNo', () => {
  it('เอาสี่หลักท้ายของ IMEI', () => {
    expect(deriveDisplayNo('350000000004218')).toBe('4218');
  });

  it('ตัดอักขระที่ไม่ใช่ตัวเลขทิ้งก่อน', () => {
    expect(deriveDisplayNo('35-0000-0000-9999')).toBe('9999');
  });

  it('ไม่มี IMEI หรือสั้นเกินไป → ไม่มีเลขให้แสดง (การ์ดจะไม่ขึ้นช่องนี้)', () => {
    expect(deriveDisplayNo(null)).toBeUndefined();
    expect(deriveDisplayNo(undefined)).toBeUndefined();
    expect(deriveDisplayNo('12')).toBeUndefined();
  });
});

describe('modelRank', () => {
  const desc = (models: string[]) => [...models].sort((a, b) => modelRank(b) - modelRank(a));

  it('รุ่นใหม่มาก่อนรุ่นเก่าเสมอ', () => {
    expect(desc(['iPhone 13', 'iPhone 16', 'iPhone 12', 'iPhone 15'])).toEqual([
      'iPhone 16',
      'iPhone 15',
      'iPhone 13',
      'iPhone 12',
    ]);
  });

  it('ในรุ่นเดียวกัน เรียง Pro Max → Pro → Plus → ตัวธรรมดา → e → mini', () => {
    expect(
      desc(['iPhone 16 mini', 'iPhone 16', 'iPhone 16 Pro Max', 'iPhone 16e', 'iPhone 16 Plus', 'iPhone 16 Pro']),
    ).toEqual([
      'iPhone 16 Pro Max',
      'iPhone 16 Pro',
      'iPhone 16 Plus',
      'iPhone 16',
      'iPhone 16e',
      'iPhone 16 mini',
    ]);
  });

  it('รุ่นเก่ากว่าไม่มีทางแซงรุ่นใหม่กว่า แม้จะเป็น Pro Max', () => {
    expect(modelRank('iPhone 15 Pro Max')).toBeLessThan(modelRank('iPhone 16e'));
  });

  it('อ่านไม่ออก (SE / ข้อมูลเพี้ยน) ได้ 0 → ไปท้ายแถว ไม่แทรกกลาง', () => {
    expect(modelRank('iPhone SE (3rd gen)')).toBe(0);
    expect(modelRank('')).toBe(0);
    expect(modelRank('MacBook Air')).toBe(0);
  });
});

describe('gradeRank', () => {
  it('A มาก่อน B ก่อน C และของที่ไม่มีเกรดไปท้ายสุด', () => {
    expect([undefined, 'C', 'A', 'B'].sort((a, b) => gradeRank(a) - gradeRank(b))).toEqual([
      'A',
      'B',
      'C',
      undefined,
    ]);
  });
});
