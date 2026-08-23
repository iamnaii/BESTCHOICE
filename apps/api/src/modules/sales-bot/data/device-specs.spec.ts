import { DEVICE_SPECS, compareDevices, findDeviceSpec } from './device-specs';

const byModel = (model: string) => {
  const s = DEVICE_SPECS.find((d) => d.model === model);
  if (!s) throw new Error(`missing spec: ${model}`);
  return s;
};

describe('DEVICE_SPECS', () => {
  const EXPECTED_MODELS = [
    'iPhone X',
    'iPhone XR',
    'iPhone XS',
    'iPhone XS Max',
    'iPhone 11',
    'iPhone 11 Pro',
    'iPhone 11 Pro Max',
    'iPhone SE (2020)',
    'iPhone SE (2022)',
    'iPhone 12 mini',
    'iPhone 12',
    'iPhone 12 Pro',
    'iPhone 12 Pro Max',
    'iPhone 13 mini',
    'iPhone 13',
    'iPhone 13 Pro',
    'iPhone 13 Pro Max',
    'iPhone 14',
    'iPhone 14 Plus',
    'iPhone 14 Pro',
    'iPhone 14 Pro Max',
    'iPhone 15',
    'iPhone 15 Plus',
    'iPhone 15 Pro',
    'iPhone 15 Pro Max',
    'iPhone 16',
    'iPhone 16 Plus',
    'iPhone 16 Pro',
    'iPhone 16 Pro Max',
    'iPhone 16e',
    'iPhone 17',
    'iPhone Air',
    'iPhone 17 Pro',
    'iPhone 17 Pro Max',
  ];

  it('ครบทุกรุ่นตามรายการ และ model ไม่ซ้ำ', () => {
    const models = DEVICE_SPECS.map((s) => s.model);
    expect(new Set(models).size).toBe(models.length);
    expect([...models].sort()).toEqual([...EXPECTED_MODELS].sort());
  });

  it('generation+variant ไม่ซ้ำกัน (เป็นคีย์ค้นหา)', () => {
    const keys = DEVICE_SPECS.map((s) => `${s.generation}/${s.variant}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ทุกรุ่นมี highlights 2-3 ข้อ ไม่มีตัวเลขราคา และ iosSupportNote ไม่ว่าง', () => {
    for (const s of DEVICE_SPECS) {
      expect(s.highlights.length).toBeGreaterThanOrEqual(2);
      expect(s.highlights.length).toBeLessThanOrEqual(3);
      for (const h of s.highlights) expect(h).not.toMatch(/บาท|฿|\d{4,}/);
      expect(s.iosSupportNote.length).toBeGreaterThan(0);
      expect(s.batteryVideoHours).toBeGreaterThan(0);
      expect(s.displayInch).toBeGreaterThan(4);
    }
  });

  it('SE ใช้ generation ตามชิป (2020 = 11 / 2022 = 13)', () => {
    expect(byModel('iPhone SE (2020)').generation).toBe(11);
    expect(byModel('iPhone SE (2022)').generation).toBe(13);
    expect(byModel('iPhone SE (2022)').faceId).toBe(false);
  });
});

describe('findDeviceSpec', () => {
  const cases: [string, string | null][] = [
    ['ใช้ 11 อยู่ค่ะ', 'iPhone 11'],
    ['ไอโฟน XR', 'iPhone XR'],
    ['15พลัส', 'iPhone 15 Plus'],
    ['iphone 13 pro max 256gb', 'iPhone 13 Pro Max'],
    ['se', 'iPhone SE (2022)'],
    ['se 2020', 'iPhone SE (2020)'],
    ['ไอโฟน 16e', 'iPhone 16e'],
    ['แอร์', 'iPhone Air'],
    ['ไอโฟนแอร์', 'iPhone Air'],
    ['เอ็กซ์เอส', 'iPhone XS'],
    ['xs max', 'iPhone XS Max'],
    ['iphone x', 'iPhone X'],
    ['ip15pm', 'iPhone 15 Pro Max'],
    ['ไอโฟน 12 มินิ', 'iPhone 12 mini'],
    ['14 โปร', 'iPhone 14 Pro'],
    ['11โปรแม็กซ์', 'iPhone 11 Pro Max'],
    ['16+', 'iPhone 16 Plus'],
    ['ตอนนี้ใช้ 13 อยู่ มีโปรโมชั่นไหม', 'iPhone 13'],
    ['ใช้ XR อยู่ อยากได้ 15', 'iPhone XR'],
    ['งบ 3000', null],
    ['งบ 15,000', null],
    ['ผ่อน 12 งวด', null],
    ['256gb', null],
    ['12 plus', null], // รุ่นไม่มีจริง → ไม่เดา
    ['airpods', null],
    ['', null],
  ];

  it.each(cases)('%s → %s', (text, expected) => {
    expect(findDeviceSpec(text)?.model ?? null).toBe(expected);
  });
});

describe('compareDevices', () => {
  it('11 → 15: better ≥3 ข้อ เรียงผลกระทบ และพูดถึง 48MP / USB-C / 5G', () => {
    const diff = compareDevices(byModel('iPhone 11'), byModel('iPhone 15'));
    expect(diff.generationGap).toBe(4);
    expect(diff.better.length).toBeGreaterThanOrEqual(3);
    const joined = diff.better.join('\n');
    expect(joined).toMatch(/48MP|USB-C|5G/);
    // ชิปต่าง 3 tier (A13→A16 ~1.6 เท่า) → ข้อแรกต้องเป็นชิป "เร็วขึ้นมาก" ไม่ใช่ "2 เท่า" (รีวิว 2026-08-23)
    expect(diff.better[0]).toContain('A13 → A16');
    expect(diff.better[0]).toContain('เร็วขึ้นมาก');
    // iOS note ของ candidate ต่างจาก current → อยู่ข้อสุดท้าย
    expect(diff.better[diff.better.length - 1]).toContain(byModel('iPhone 15').iosSupportNote);
    expect(diff.worse).toEqual([]);
    // ไม่มีตัวเลขเงิน
    expect(joined).not.toMatch(/บาท|฿/);
  });

  it('15 Pro Max → 16: worse พูดถึงจอ/แบต/กล้องอย่างซื่อสัตย์', () => {
    const diff = compareDevices(byModel('iPhone 15 Pro Max'), byModel('iPhone 16'));
    expect(diff.generationGap).toBe(1);
    const worse = diff.worse.join('\n');
    expect(worse).toMatch(/จอ/);
    expect(worse).toMatch(/แบต/);
    expect(worse).toMatch(/กล้อง/);
    // ชิปใหม่กว่านิดเดียว → ยังเป็น better แต่ใช้คำว่า "อีกนิด"
    expect(diff.better.some((b) => b.includes('เร็วขึ้นอีกนิด'))).toBe(true);
  });

  it('13 → 13: better/worse ว่าง, same มีข้อมูล', () => {
    const diff = compareDevices(byModel('iPhone 13'), byModel('iPhone 13'));
    expect(diff.better).toEqual([]);
    expect(diff.worse).toEqual([]);
    expect(diff.generationGap).toBe(0);
    expect(diff.same.length).toBeGreaterThan(0);
  });

  it('SE (2022) → 16e: Face ID + OLED + กล้อง 48MP', () => {
    const diff = compareDevices(byModel('iPhone SE (2022)'), byModel('iPhone 16e'));
    const all = diff.better.join('\n');
    expect(all).toMatch(/48MP/);
    expect(diff.better.length).toBeLessThanOrEqual(4); // 3 ข้อ + iOS note
    expect(diff.worse).toEqual([]);
  });

  it('15 → 11 (ย้อนรุ่น): worse บอกหมดทั้งชิป/กล้อง/5G และ iOS note ไปอยู่ใน worse', () => {
    const diff = compareDevices(byModel('iPhone 15'), byModel('iPhone 11'));
    expect(diff.generationGap).toBe(-4);
    expect(diff.better).toEqual([]);
    const worse = diff.worse.join('\n');
    expect(worse).toMatch(/ชิป/);
    expect(worse).toMatch(/5G/);
    expect(worse).toMatch(/48MP → 12MP/);
    expect(diff.worse[diff.worse.length - 1]).toBe(byModel('iPhone 11').iosSupportNote);
  });
});
