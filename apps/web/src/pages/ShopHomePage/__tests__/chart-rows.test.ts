import { describe, it, expect } from 'vitest';
import { buildChartRows } from '../components/MonthlyChart';

/** แถวข้อมูลของกราฟ 6 เดือน — ป้ายกำไรขั้นต้นเหนือแท่ง + เน้นเดือนปัจจุบัน (spec §4 ข้อ 4) */
describe('buildChartRows', () => {
  it('แปลงเดือนเป็นชื่อไทย คงค่ากำไรขั้นต้นไว้ใส่ป้าย และเน้นเฉพาะเดือนสุดท้าย', () => {
    const rows = buildChartRows([
      { month: '2026-08', sales: 341000, cost: 236000, grossProfit: 105000 },
      { month: '2026-09', sales: 372000, cost: 254000, grossProfit: 118000 },
      { month: '2026-10', sales: 384400, cost: 266000, grossProfit: 118400 },
    ]);
    expect(rows.map((r) => r.month)).toEqual(['ส.ค.', 'ก.ย.', 'ต.ค.']);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, false, true]);
    expect(rows[2]).toMatchObject({ ยอดขาย: 384400, ต้นทุน: 266000, กำไรขั้นต้น: 118400 });
  });

  it('เมื่อ server ตัดต้นทุน (null) → ต้นทุนและกำไรขั้นต้นเป็น null ไม่ใช่ 0 ปลอม', () => {
    const rows = buildChartRows([{ month: '2026-10', sales: 384400, cost: null, grossProfit: null }]);
    expect(rows[0]).toMatchObject({ ยอดขาย: 384400, ต้นทุน: null, กำไรขั้นต้น: null, isCurrent: true });
  });
});
