import { BrokenPromiseFinanceCron } from './broken-promise-finance.cron';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/**
 * รอบ 02:00 น. ไทยตัด "ผิดนัด" เมื่อวันนัด (ปฏิทินไทย) ผ่านไปเต็มหนึ่งวัน (2026-11-18)
 * = จังหวะเดิมบน prod (promised_date < CURRENT_DATE ของ session UTC) แต่ไม่ขึ้นกับ TZ ของ session ฐานข้อมูล
 * เว้นหนึ่งวันให้พนักงานบันทึกรับเงินตามนัดได้ก่อนนัดถูกตัด (บันทึกหลังถูกตัด = ผิดนัดถาวร)
 */
describe('BrokenPromiseFinanceCron — เส้นตัดวันนัดตามเวลาไทย', () => {
  const prisma = { $executeRaw: jest.fn() };
  const cron = new BrokenPromiseFinanceCron(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(3);
  });
  afterEach(() => jest.useRealTimers());

  it('รอบ 02:00 น. ไทย 19 พ.ย.: เส้นตัด = 00:00 น. ไทยของ 18 พ.ย. (นัดวันที่ 17 ลงไปถือว่าผิดนัด · นัดวันที่ 18 ยังไม่)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z')); // 2026-11-19 02:00 น. ไทย

    await expect(cron.handleCron()).resolves.toBe(3);

    const { text, values } = renderSqlCall(prisma.$executeRaw.mock.calls[0]);
    expect(text).toContain('WHERE promised_date < ?::timestamp');
    expect(text).not.toContain('CURRENT_DATE');
    expect(values).toEqual(['2026-11-17T17:00:00.000Z']);
  });

  it('นัดที่บันทึกจากเว็บ (YYYY-MM-DD → 00:00Z = 07:00 น. ไทย) ของวันที่ 17 อยู่ก่อนเส้นตัด · ของวันที่ 18 ไม่อยู่', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z'));
    await cron.handleCron();

    const cutoff = new Date(renderSqlCall(prisma.$executeRaw.mock.calls[0]).values[0] as string).getTime();
    expect(new Date('2026-11-17').getTime() < cutoff).toBe(true);
    expect(new Date('2026-11-18').getTime() < cutoff).toBe(false);
  });

  it('เงื่อนไขอื่นของรอบคงเดิม', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z'));
    await cron.handleCron();

    const { text } = renderSqlCall(prisma.$executeRaw.mock.calls[0]);
    expect(text).toContain('SET promised_broken_at = now()');
    expect(text).toContain('AND promised_broken_at IS NULL');
    expect(text).toContain('AND promised_kept_at IS NULL');
    expect(text).toContain("AND result = 'PROMISED'");
    expect(text).toContain("WHERE status NOT IN ('RECEIVED', 'PARTIALLY_RECEIVED')");
  });
});
