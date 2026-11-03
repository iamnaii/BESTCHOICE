import { execFileSync } from 'node:child_process';
import { nextEntryNumber } from './entry-number.util';

/**
 * เลขที่รายการบัญชี `JE-YYYYMM-NNNNN` ต้องใช้เดือนตามปฏิทินไทยเสมอ ไม่ขึ้นกับเขตเวลาของโปรเซส
 * (Task 36 fix round 1 · m-h — CI รันใต้ TZ=UTC แล้วรายการที่ลงเที่ยงคืนไทยวันที่ 1 = 17:00Z ของวันก่อน
 * เคยได้เลขเดือนก่อน ทำให้เรียงวันเดียวกันด้วยเลขที่ผิดลำดับ)
 */
function fakeTx(max: number | null = null) {
  const locks: unknown[] = [];
  const prefixes: unknown[] = [];
  const tx = {
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      locks.push(values[0]);
      return 0;
    }),
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      prefixes.push(values.find((v) => typeof v === 'string'));
      return [{ max }];
    }),
  };
  return { tx: tx as never, locks, prefixes };
}

describe('nextEntryNumber — เดือนตามปฏิทินไทย', () => {
  it.each([
    ['23:59:59.999 น. วันสุดท้ายของเดือน (ไทย)', '2026-10-31T16:59:59.999Z', '202610'],
    ['เที่ยงคืนไทยวันที่ 1 (= 17:00Z ของวันก่อน)', '2026-10-31T17:00:00.000Z', '202611'],
    ['09:45 น. วันที่ 1 (CI 1 พ.ย. 2026 02:45Z)', '2026-11-01T02:45:00.000Z', '202611'],
    ['เที่ยงคืนไทย 1 ม.ค. ข้ามปี', '2026-12-31T17:00:00.000Z', '202701'],
    ['กลางเดือน', '2026-11-15T05:00:00.000Z', '202611'],
  ])('%s (%s) → JE-%s-… และล็อกเดือนเดียวกัน', async (_label, instant, ym) => {
    const { tx, locks, prefixes } = fakeTx(41);
    await expect(nextEntryNumber(tx, new Date(instant))).resolves.toBe(`JE-${ym}-00042`);
    expect(locks).toEqual([Number(ym)]);
    expect(prefixes).toEqual([`JE-${ym}-%`]);
  });

  it('บน prod (TZ=Asia/Bangkok) เลขที่ไม่เปลี่ยน — ตรงกับสูตรเดิม (getFullYear/getMonth) ที่รันในโปรเซส TZ=Asia/Bangkok จริง ทุกขอบเดือน 2024–2030', async () => {
    const instants: number[] = [];
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 0; m < 12; m++) {
        const boundary = Date.UTC(y, m, 1) - 7 * 60 * 60 * 1000; // 00:00 ไทยวันที่ 1
        for (const offset of [-1, 0, 1, 12 * 3600_000, 15 * 86_400_000])
          instants.push(boundary + offset);
      }
    }
    // jest แยก process.env ของเทสต์ — ตั้ง TZ ระหว่างรันไม่มีผลกับนาฬิกา ⇒ รันสูตรเดิมในโปรเซสลูกที่ TZ=Asia/Bangkok จริง
    const legacyScript =
      'const xs = JSON.parse(process.argv[1]);' +
      'process.stdout.write(JSON.stringify({ offset: new Date(xs[0]).getTimezoneOffset(), yms: xs.map((t) => { const at = new Date(t);' +
      " return `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}`; }) }));";
    const out = execFileSync(process.execPath, ['-e', legacyScript, JSON.stringify(instants)], {
      env: { PATH: process.env.PATH ?? '', TZ: 'Asia/Bangkok' },
      encoding: 'utf8',
    });
    const legacy = JSON.parse(out) as { offset: number; yms: string[] };
    expect(legacy.offset).toBe(-420); // โปรเซสลูกอยู่เขตไทยจริง
    for (const [k, t] of instants.entries()) {
      const { tx } = fakeTx();
      await expect(nextEntryNumber(tx, new Date(t))).resolves.toBe(`JE-${legacy.yms[k]}-00001`);
    }
  });
});
