import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { RepossessionJP5Template } from './cpa-templates/repossession-jp5.template';
import { CLOSE_ADVANCE_MISMATCH_MESSAGE } from './contract-close-advances';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * ยึดเครื่อง (JP5) หักเงินของลูกค้าที่ค้างทุกประเภทก่อนคำนวณผลจากการยึด — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 6
 * (29/09/2569) ทางเลือก (1): 21-1103 (บรรทัดเงินพักปรับดิวเดิม + ส่วนที่เหลือทุกถัง) และ 21-5101 ตามยอดในบัญชี.
 *
 * สัญญาในตัวอย่างของฝ่ายบัญชี (ข้อ 5 ฉบับรวม): 17,000/12 งวดละ 1,515.83 จ่ายแล้ว 4 งวด (ตั้งลูกหนี้งวดและรับเงินครบ)
 * ค้าง 8 งวดที่ยังไม่ตั้ง — ยอดในบัญชี 11-2101 11,333.36 · 11-2105 793.32 · 11-2106 4,000.00 · 21-2102 793.32
 * (งวดสุดท้ายรับเศษของสัญญา → รวม 12,126.68) · ราคาประเมิน 7,000.00. ยอดในบัญชีจำลองผ่าน journalLine.findMany
 */
describe('RepossessionJP5Template — หักเงินของลูกค้าที่ค้างก่อนคำนวณผลจากการยึด (PR6)', () => {
  const dec = (v: string) => new Decimal(v);
  const zero = dec('0');

  type Gl = Record<string, { dr?: string; cr?: string }>;
  type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type Posted = { metadata: Record<string, unknown>; lines: Line[] };

  const EIGHT_REMAINING: Gl = {
    '11-2101': { dr: '11333.36' },
    '11-2105': { dr: '793.32' },
    '11-2106': { cr: '4000.00' },
    '21-2102': { cr: '793.32' },
  };

  function build(opts: {
    gl: Gl;
    columns?: {
      advanceBalance?: string;
      rescheduleAdvanceBalance?: string;
      creditBalance?: string;
    };
  }) {
    const contract = {
      id: 'contract-1',
      contractNumber: 'CT-0001',
      totalMonths: 12,
      financedAmount: dec('10000'),
      storeCommission: dec('1000'),
      interestTotal: dec('6000'),
      vatAmount: dec('1190'),
      advanceBalance: dec(opts.columns?.advanceBalance ?? '0'),
      rescheduleAdvanceBalance: dec(opts.columns?.rescheduleAdvanceBalance ?? '0'),
      creditBalance: dec(opts.columns?.creditBalance ?? '0'),
    };
    // งวด 1-4 ตั้งลูกหนี้งวดและรับเงินครบแล้ว · งวด 5-12 ยังไม่ตั้ง
    const installments = Array.from({ length: 12 }, (_, i) => ({
      id: `inst-${i + 1}`,
      installmentNo: i + 1,
      dueDate: new Date(Date.UTC(2026, i, 1)),
      accrualJournalEntryId: i < 4 ? `je-2a-${i + 1}` : null,
    }));
    const payments = [1, 2, 3, 4].map((no) => ({
      installmentNo: no,
      status: 'PAID',
      amountDue: dec('1515.83'),
      amountPaid: dec('1515.83'),
      lateFee: zero,
      lateFeeWaived: false,
      dueDate: new Date(Date.UTC(2026, no - 1, 1)),
    }));
    const client = {
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installments) },
      payment: { findMany: jest.fn().mockResolvedValue(payments) },
      journalLine: {
        findMany: jest.fn(async (args: { where: { accountCode: string } }) => {
          const g = opts.gl[args.where.accountCode];
          return g ? [{ debit: dec(g.dr ?? '0'), credit: dec(g.cr ?? '0') }] : [];
        }),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '21-1103', name: 'เงินรับล่วงหน้า-ชำระก่อนครบกำหนด' },
          { code: '21-5101', name: 'เงินเกินของลูกค้า (Customer Credit Balance)' },
        ]),
      },
    };
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-JP5-1' });
    const template = new RepossessionJP5Template({ createAndPost } as never, client as never);
    const posted = (): Posted => createAndPost.mock.calls[0][0] as Posted;
    return { template, client, createAndPost, posted };
  }

  const base = {
    contractId: 'contract-1',
    depositAccountCode: '11-2107',
    repossessionValue: dec('7000.00'),
    shopReceivableType: 'DEVICE_RETURN' as const,
  };
  const tuples = (lines: Line[]) =>
    lines.map((l) => `${l.accountCode} ${l.dr.toFixed(2)} ${l.cr.toFixed(2)}`);
  const sum = (lines: Line[], side: 'dr' | 'cr') =>
    lines.reduce((s, l) => s.plus(l[side]), zero).toFixed(2);

  beforeEach(() => jest.clearAllMocks());

  it('เงินรับล่วงหน้าถังรวม 500 + เงินเกินของลูกค้า 300 → Dr 21-1103 500 · Dr 21-5101 300 ก่อน plug · ขาดทุน 5,126.68 − 800.00 = 4,326.68', async () => {
    const { template, client, posted } = build({
      gl: { ...EIGHT_REMAINING, '21-1103': { cr: '500.00' }, '21-5101': { cr: '300.00' } },
      columns: { advanceBalance: '500.00', creditBalance: '300.00' },
    });

    const result = await template.execute(base, client as never);

    expect(tuples(posted().lines)).toEqual([
      '11-2107 7000.00 0.00',
      '11-2106 4000.00 0.00',
      '21-2102 793.32 0.00',
      '11-2101 0.00 11333.36',
      '11-2105 0.00 793.32',
      '21-2101 0.00 793.32',
      '41-1101 0.00 4000.00',
      '21-1103 500.00 0.00',
      '21-5101 300.00 0.00',
      '51-1102 4326.68 0.00',
    ]);
    expect(sum(posted().lines, 'dr')).toBe('16920.00');
    expect(sum(posted().lines, 'cr')).toBe('16920.00');
    // ไม่มีข้อความใหม่ — การ์ดรายการ JP5 แสดงชื่อบัญชีจากผังบัญชี
    for (const code of ['21-1103', '21-5101']) {
      expect(posted().lines.find((l) => l.accountCode === code)?.description).toBeUndefined();
    }
    expect(posted().metadata).toMatchObject({
      flow: 'repossession',
      advanceRelief: '500.00',
      creditRelief: '300.00',
    });
    expect(posted().metadata).not.toHaveProperty('parkRelief');
    expect(result.parkRelief.toFixed(2)).toBe('0.00');
    expect(result.advanceRelief.toFixed(2)).toBe('500.00');
    expect(result.creditRelief.toFixed(2)).toBe('300.00');
    expect(result.warnings).toEqual([]);
  });

  it('ถังพัก 354 (ยอดปิดดูดซับครบ) + ถังรวม 500 → บรรทัดเงินพักปรับดิว 354 (คำอธิบายเดิม) + บรรทัดเงินรับล่วงหน้าที่เหลือ 500', async () => {
    const { template, client, posted } = build({
      gl: { ...EIGHT_REMAINING, '21-1103': { cr: '854.00' } },
      columns: { advanceBalance: '500.00', rescheduleAdvanceBalance: '354.00' },
    });

    const result = await template.execute({ ...base, parkRelief: dec('354.00') }, client as never);

    const advanceLines = posted().lines.filter((l) => l.accountCode === '21-1103');
    expect(advanceLines.map((l) => [l.dr.toFixed(2), l.description])).toEqual([
      ['354.00', 'หักเงินพักปรับดิว 354.00 ฿ (ยึดคืน)'],
      ['500.00', undefined],
    ]);
    expect(
      posted()
        .lines.find((l) => l.accountCode === '51-1102')
        ?.dr.toFixed(2),
    ).toBe('4272.68');
    expect(posted().metadata).toMatchObject({ parkRelief: '354.00', advanceRelief: '500.00' });
    expect(result.parkRelief.toFixed(2)).toBe('354.00');
    expect(result.advanceRelief.toFixed(2)).toBe('500.00');
    expect(result.warnings).toEqual([]);
  });

  it('ยอดปิดดูดซับถังพักได้ 200 จาก 354 → ส่วนที่เหลือ 154 ถูกหักด้วยบรรทัดเงินรับล่วงหน้าที่เหลือ (ไม่ค้างในบัญชีหลังยึด)', async () => {
    const { template, client, posted } = build({
      gl: { ...EIGHT_REMAINING, '21-1103': { cr: '354.00' } },
      columns: { rescheduleAdvanceBalance: '354.00' },
    });

    const result = await template.execute({ ...base, parkRelief: dec('200.00') }, client as never);

    expect(
      posted()
        .lines.filter((l) => l.accountCode === '21-1103')
        .map((l) => l.dr.toFixed(2)),
    ).toEqual(['200.00', '154.00']);
    expect(result.parkRelief.toFixed(2)).toBe('200.00');
    expect(result.advanceRelief.toFixed(2)).toBe('154.00');
    expect(
      posted()
        .lines.find((l) => l.accountCode === '51-1102')
        ?.dr.toFixed(2),
    ).toBe('4772.68');
  });

  it('กำไร (ราคาประเมิน 13,000) + เงินเกินของลูกค้า 300 → กำไร 41-1102 873.32 + 300.00 = 1,173.32', async () => {
    const { template, client, posted } = build({
      gl: { ...EIGHT_REMAINING, '21-5101': { cr: '300.00' } },
      columns: { creditBalance: '300.00' },
    });

    await template.execute({ ...base, repossessionValue: dec('13000.00') }, client as never);

    expect(
      posted()
        .lines.find((l) => l.accountCode === '41-1102')
        ?.cr.toFixed(2),
    ).toBe('1173.32');
    expect(posted().lines.find((l) => l.accountCode === '51-1102')).toBeUndefined();
    expect(sum(posted().lines, 'dr')).toBe(sum(posted().lines, 'cr'));
  });

  it('คอลัมน์เครดิต 2,000 แต่บัญชี 21-5101 ไม่มียอด → ไม่มีบรรทัด 21-5101 · คืนสัญญาณเตือนให้ผู้เรียกส่งหลัง commit', async () => {
    const { template, client, posted } = build({
      gl: EIGHT_REMAINING,
      columns: { creditBalance: '2000.00' },
    });

    const result = await template.execute(base, client as never);

    expect(posted().lines.find((l) => l.accountCode === '21-5101')).toBeUndefined();
    expect(result.creditRelief.toFixed(2)).toBe('0.00');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      message: CLOSE_ADVANCE_MISMATCH_MESSAGE,
      tags: { flow: 'repossession' },
      extra: { contractId: 'contract-1', ledger21_5101: '0.00', creditBalance: '2000.00' },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ไม่ส่งธุรกรรม → template ส่งสัญญาณเตือนเองหลังลงรายการ (ระดับ warning) และคืนรายการว่าง', async () => {
    const { template } = build({ gl: EIGHT_REMAINING, columns: { creditBalance: '2000.00' } });

    const result = await template.execute(base);

    expect(result.warnings).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('ตัวอย่างบนจอ (previewJe) = รายการที่ลงจริงทุกบรรทัด · บรรทัดใหม่แสดงชื่อบัญชี คำอธิบายว่าง', async () => {
    const gl: Gl = { ...EIGHT_REMAINING, '21-1103': { cr: '500.00' }, '21-5101': { cr: '300.00' } };
    const columns = { advanceBalance: '500.00', creditBalance: '300.00' };
    const posting = build({ gl, columns });
    await posting.template.execute(base, posting.client as never);
    const preview = await build({ gl, columns }).template.previewJe(base);

    expect(preview.lines.map((l) => `${l.accountCode} ${l.debit} ${l.credit}`)).toEqual(
      tuples(posting.posted().lines),
    );
    expect(preview.isBalanced).toBe(true);
    expect(preview.lines.find((l) => l.accountCode === '21-5101')).toMatchObject({
      accountName: 'เงินเกินของลูกค้า (Customer Credit Balance)',
      description: '',
    });
  });

  /**
   * ส่วนลดยอดปิด — คำตอบฝ่ายบัญชี ฉบับรวม ข้อ 5 (30/09/2569) "แบบ (ก) ลงส่วนลดแยกที่ 52-1106". ตัวอย่างของคำถาม:
   * บนจอ ยอดค้าง 8 งวด 12,126.64 · ส่วนลด 50% = 1,999.99 · ยอดปิด 10,126.65 · ขาดทุน 3,126.65 — ในบัญชี 12,126.68
   * (งวดสุดท้ายรับเศษ 0.04) ⇒ แบบ (ก): 52-1106 1,999.99 · 51-1102 3,126.69 · ทั้งสองฝั่ง 16,920.00
   */
  describe('ส่วนลดยอดปิด 52-1106 (แบบ ก)', () => {
    it('ตัวอย่างฝ่ายบัญชี: รายการตามตารางแบบ (ก) ทุกบรรทัด — 52-1106 1,999.99 · 51-1102 3,126.69 · รวม 16,920.00', async () => {
      const { template, client, posted } = build({ gl: EIGHT_REMAINING });

      await template.execute({ ...base, discount: dec('1999.99') }, client as never);

      expect(tuples(posted().lines)).toEqual([
        '11-2107 7000.00 0.00',
        '11-2106 4000.00 0.00',
        '21-2102 793.32 0.00',
        '11-2101 0.00 11333.36',
        '11-2105 0.00 793.32',
        '21-2101 0.00 793.32',
        '41-1101 0.00 4000.00',
        '52-1106 1999.99 0.00',
        '51-1102 3126.69 0.00',
      ]);
      expect(sum(posted().lines, 'dr')).toBe('16920.00');
      expect(sum(posted().lines, 'cr')).toBe('16920.00');
      expect(posted().lines.find((l) => l.accountCode === '52-1106')?.description).toBeUndefined();
      expect(posted().metadata).toMatchObject({ discount: '1999.99' });
    });

    it('ไม่ส่งส่วนลด (รายการแบบ (ข) เดิม) → ไม่มี 52-1106 · 51-1102 5,126.68', async () => {
      const { template, client, posted } = build({ gl: EIGHT_REMAINING });

      await template.execute(base, client as never);

      expect(posted().lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
      expect(
        posted()
          .lines.find((l) => l.accountCode === '51-1102')
          ?.dr.toFixed(2),
      ).toBe('5126.68');
      expect(posted().metadata).not.toHaveProperty('discount');
    });

    it('ส่วนลด 0 → ไม่มีบรรทัด 52-1106', async () => {
      const { template, client, posted } = build({ gl: EIGHT_REMAINING });

      await template.execute({ ...base, discount: dec('0') }, client as never);

      expect(posted().lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    });

    it('ส่วนลดมากกว่าขาดทุนก่อนส่วนลด (ราคาประเมิน 11,000) → กำไร 41-1102 = 1,999.99 − 1,126.68 = 873.31 · ผลรวมกำไรขาดทุนเท่าเดิม', async () => {
      const { template, client, posted } = build({ gl: EIGHT_REMAINING });

      await template.execute(
        { ...base, repossessionValue: dec('11000.00'), discount: dec('1999.99') },
        client as never,
      );

      const lines = posted().lines;
      expect(lines.find((l) => l.accountCode === '52-1106')?.dr.toFixed(2)).toBe('1999.99');
      expect(lines.find((l) => l.accountCode === '41-1102')?.cr.toFixed(2)).toBe('873.31');
      expect(lines.find((l) => l.accountCode === '51-1102')).toBeUndefined();
      // −52-1106 + 41-1102 = −1,126.68 = ผลเดิมเมื่อไม่แยกส่วนลด (12,126.68 − 11,000.00)
      expect(dec('873.31').minus(dec('1999.99')).toFixed(2)).toBe('-1126.68');
      expect(sum(lines, 'dr')).toBe(sum(lines, 'cr'));
    });

    it('ค่าเผื่อหนี้สงสัยจะสูญ 4,000 ใช้กับขาดทุน 51-1102 หลังส่วนลดเท่านั้น → ใช้ 3,126.69 คืน 873.31', async () => {
      const { template, client, posted } = build({
        gl: { ...EIGHT_REMAINING, '11-2102': { cr: '4000.00' } },
      });

      await template.execute({ ...base, discount: dec('1999.99') }, client as never);

      expect(
        tuples(
          posted().lines.filter((l) =>
            ['52-1106', '11-2102', '51-1103', '51-1102'].includes(l.accountCode),
          ),
        ),
      ).toEqual([
        '52-1106 1999.99 0.00',
        '11-2102 3126.69 0.00',
        '11-2102 873.31 0.00',
        '51-1103 0.00 873.31',
      ]);
      expect(posted().metadata).toMatchObject({ releasedProvision: '873.31', discount: '1999.99' });
    });

    it('ส่วนลด + เงินรับล่วงหน้า + เงินเกิน พร้อมกัน → หักทั้งหมดก่อน plug: 12,126.68 − 7,000 − 500 − 300 − 1,999.99 = 2,326.69', async () => {
      const { template, client, posted } = build({
        gl: { ...EIGHT_REMAINING, '21-1103': { cr: '500.00' }, '21-5101': { cr: '300.00' } },
        columns: { advanceBalance: '500.00', creditBalance: '300.00' },
      });

      await template.execute({ ...base, discount: dec('1999.99') }, client as never);

      expect(
        posted()
          .lines.find((l) => l.accountCode === '51-1102')
          ?.dr.toFixed(2),
      ).toBe('2326.69');
      expect(sum(posted().lines, 'dr')).toBe(sum(posted().lines, 'cr'));
    });
  });
});
