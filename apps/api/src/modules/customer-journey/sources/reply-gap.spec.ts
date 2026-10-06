import { formatReplyGap } from './reply-gap';

const NBSP = ' ';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatReplyGap — ระยะห่าง "หลังทัก" ของแถวร้านตอบครั้งแรก (คำตัดสินข้อ 12)', () => {
  it.each<[number, string]>([
    [0, `1${NBSP}นาที`],
    [59_999, `1${NBSP}นาที`],
    [59 * MIN, `59${NBSP}นาที`],
    [60 * MIN - 1, `59${NBSP}นาที`],
    [60 * MIN, `1${NBSP}ชม.`],
    [23 * HOUR + 59 * MIN, `23${NBSP}ชม.`],
    [DAY - 1, `23${NBSP}ชม.`],
    [DAY, `1${NBSP}วัน`],
    [2 * DAY + 23 * HOUR, `2${NBSP}วัน`],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatReplyGap(ms)).toBe(expected);
  });

  it('เลขติดหน่วยด้วยเว้นวรรคไม่ตัดบรรทัด (U+00A0) ไม่มีเว้นวรรคธรรมดา', () => {
    for (const ms of [0, 90 * MIN, 3 * DAY]) {
      expect(formatReplyGap(ms)).toContain(NBSP);
      expect(formatReplyGap(ms)).not.toContain(' ');
    }
  });
});
