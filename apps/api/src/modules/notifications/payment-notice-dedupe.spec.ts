import {
  autoPayLinkPaymentWhere,
  findContractsDunnedToday,
  noticeDueWindow,
} from './payment-notice-dedupe';

/** Task 30 รอบ 3 C1 — "T±n" ของผู้ส่งข้อความเรื่องงวดเป็นวันปฏิทินไทย ไม่ขึ้นกับ TZ เครื่อง และครอบ dueDate ที่เก็บเที่ยงคืนไทย */
describe('noticeDueWindow', () => {
  // 1 ธ.ค. 2569 08:00 น. ไทย = 01:00Z · ตอนตีหนึ่งไทยวัน UTC ยังเป็นวันก่อน
  const at0800 = new Date('2026-12-01T01:00:00Z');
  const at0030 = new Date('2026-11-30T17:30:00Z');

  it.each([
    [0, '2026-11-30T17:00:00.000Z', '2026-12-01T17:00:00.000Z'],
    [3, '2026-12-03T17:00:00.000Z', '2026-12-04T17:00:00.000Z'],
    [-1, '2026-11-29T17:00:00.000Z', '2026-11-30T17:00:00.000Z'],
  ])('T%i ของ 1 ธ.ค. (ไทย) = [%s, %s)', (days, gte, lt) => {
    for (const now of [at0800, at0030]) {
      const window = noticeDueWindow(now, days);
      expect(window.gte.toISOString()).toBe(gte);
      expect(window.lt.toISOString()).toBe(lt);
    }
  });

  it('dueDate ที่เก็บเที่ยงคืนไทยของวันครบกำหนดตกในหน้าต่าง T0 ไม่ใช่ T-1/T+1', () => {
    const due = new Date('2026-11-30T17:00:00Z'); // 1 ธ.ค. 00:00 น. ไทย
    const inside = (d: number) => {
      const w = noticeDueWindow(at0800, d);
      return due >= w.gte && due < w.lt;
    };
    expect([inside(-1), inside(0), inside(1)]).toEqual([false, true, false]);
  });

  it('ลิงก์ชำระอัตโนมัติใช้หน้าต่าง T-3 ตัวเดียวกัน', () => {
    expect(autoPayLinkPaymentWhere(at0800).dueDate).toEqual(noticeDueWindow(at0800, 3));
  });
});

/** Task 30 รอบ 4 I2 — ข้อความทวงระดับสัญญาวันนี้ (A2/บอททวง/รอบเช้า 08:05 อ่าน) */
describe('findContractsDunnedToday', () => {
  it('ไม่มีสัญญา → ไม่ query', async () => {
    const findMany = jest.fn();
    await expect(
      findContractsDunnedToday({ notificationLog: { findMany } } as never, []),
    ).resolves.toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('วันนี้ = ตั้งแต่เที่ยงคืนไทย · id ซ้ำถามครั้งเดียว · คืนชุด id สัญญา', async () => {
    const findMany = jest.fn().mockResolvedValue([{ relatedId: 'c1' }, { relatedId: 'c1' }]);
    const at0030 = new Date('2026-11-30T17:30:00Z'); // 1 ธ.ค. 00:30 น. ไทย

    const result = await findContractsDunnedToday(
      { notificationLog: { findMany } } as never,
      ['c1', 'c2', 'c1'],
      at0030,
    );

    expect(result).toEqual(new Set(['c1']));
    const { where } = findMany.mock.calls[0][0];
    expect(where.relatedId).toEqual({ in: ['c1', 'c2'] });
    expect(where.OR[0].sentAt.gte.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});
