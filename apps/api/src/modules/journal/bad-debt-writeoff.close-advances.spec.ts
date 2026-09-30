import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { BadDebtWriteOffTemplate } from './cpa-templates/bad-debt-writeoff.template';
import { CLOSE_ADVANCE_MISMATCH_MESSAGE } from './contract-close-advances';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * ตัดหนี้สูญหักเงินของลูกค้าที่ค้างทุกประเภทก่อนคำนวณหนี้สูญ — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 6 (29/09/2569)
 * ทางเลือก (1) "หักทุกประเภท ทั้งสองกรณี": 21-1103 (ถังพักค่าปรับดิว + ถังรวม) และ 21-5101 ตามยอดในบัญชี.
 * ยอดในบัญชีจำลองผ่าน journalLine.findMany (glContractBalance) — ไม่ต่อฐาน
 */
describe('BadDebtWriteOffTemplate — หักเงินของลูกค้าที่ค้างก่อนคำนวณหนี้สูญ (PR6)', () => {
  const dec = (v: string) => new Decimal(v);
  const zero = dec('0');

  type Gl = Record<string, { dr?: string; cr?: string }>;
  type Line = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type Posted = { metadata: Record<string, unknown>; lines: Line[] };

  /** ลูกหนี้คงเหลือ 6 งวด (งวดละ 6,078.67 = 5,681.00 + VAT 397.67) ที่ยังไม่ตั้งลูกหนี้งวด — รวม VAT 36,472.02 */
  const SIX_DEFERRED: Gl = {
    '11-2101': { dr: '34086.00' },
    '11-2105': { dr: '2386.02' },
    '11-2106': { cr: '6000.00' },
    '21-2102': { cr: '2386.02' },
  };
  /** สัญญามาตรฐาน 17,000/12 หลังรายการเปิดสัญญา (1A) — ลูกหนี้รวม VAT 18,190.00 */
  const STANDARD_1A: Gl = {
    '11-2101': { dr: '17000.00' },
    '11-2105': { dr: '1190.00' },
    '11-2106': { cr: '6000.00' },
    '21-2102': { cr: '1190.00' },
  };

  function build(opts: {
    gl: Gl;
    columns?: {
      advanceBalance?: string;
      rescheduleAdvanceBalance?: string;
      creditBalance?: string;
    };
    existingEntry?: string;
  }) {
    const contract = {
      id: 'contract-1',
      contractNumber: 'CT-0001',
      advanceBalance: dec(opts.columns?.advanceBalance ?? '0'),
      rescheduleAdvanceBalance: dec(opts.columns?.rescheduleAdvanceBalance ?? '0'),
      creditBalance: dec(opts.columns?.creditBalance ?? '0'),
      totalMonths: 12,
      financedAmount: dec('10000'),
      storeCommission: dec('1000'),
      interestTotal: dec('6000'),
      vatAmount: dec('1190'),
    };
    const client = {
      journalEntry: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.existingEntry ? { entryNumber: opts.existingEntry } : null),
      },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      journalLine: {
        findMany: jest.fn(async (args: { where: { accountCode: string } }) => {
          const g = opts.gl[args.where.accountCode];
          return g ? [{ debit: dec(g.dr ?? '0'), credit: dec(g.cr ?? '0') }] : [];
        }),
      },
      // ใบลดหนี้ (computeCnBreakdown) — ไม่มีงวดที่ตั้งลูกหนี้งวดแล้ว
      installmentSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-WO-1' });
    const template = new BadDebtWriteOffTemplate({ createAndPost } as never, client as never);
    const posted = (): Posted => createAndPost.mock.calls[0][0] as Posted;
    return { template, client, createAndPost, posted };
  }

  const tuples = (lines: Line[]) =>
    lines.map((l) => `${l.accountCode} ${l.dr.toFixed(2)} ${l.cr.toFixed(2)}`);

  beforeEach(() => jest.clearAllMocks());

  it('ตัวอย่างฝ่ายบัญชี: ลูกหนี้คงเหลือ 6 งวดรวม VAT 36,472.02 หักเงินรับล่วงหน้า 1,419.00 → หนี้สูญ 35,053.02', async () => {
    const { template, client, posted } = build({
      gl: { ...SIX_DEFERRED, '21-1103': { cr: '1419.00' } },
      columns: { rescheduleAdvanceBalance: '1419.00' },
    });

    const result = await template.execute({ contractId: 'contract-1' }, client as never);

    expect(tuples(posted().lines)).toEqual([
      '11-2106 6000.00 0.00',
      '21-2102 2386.02 0.00',
      '11-2101 0.00 34086.00',
      '11-2105 0.00 2386.02',
      '21-2101 0.00 2386.02',
      '41-1101 0.00 6000.00',
      '21-1103 1419.00 0.00',
      '51-1102 35053.02 0.00',
    ]);
    const advanceLine = posted().lines.find((l) => l.accountCode === '21-1103');
    expect(advanceLine?.description).toBeUndefined(); // ไม่มีข้อความใหม่ — จอแสดงชื่อบัญชี
    expect(posted().metadata).toMatchObject({
      flow: 'write-off',
      advanceRelief: '1419.00',
      writeOffExpense: '35053.02',
      provisionConsumed: '0.00',
    });
    expect(posted().metadata).not.toHaveProperty('creditRelief');
    expect(result.entryNo).toBe('JE-WO-1');
    expect(result.advanceRelief.toFixed(2)).toBe('1419.00');
    expect(result.creditRelief.toFixed(2)).toBe('0.00');
    expect(result.warnings).toEqual([]);
  });

  it('ไม่มีเงินรับล่วงหน้าค้าง → หนี้สูญ 36,472.02 และรายการเท่าเดิม (ไม่มีขา 21-1103 / ไม่มี advanceRelief)', async () => {
    const { template, client, posted } = build({ gl: SIX_DEFERRED });

    await template.execute({ contractId: 'contract-1' }, client as never);

    expect(posted().lines.find((l) => l.accountCode === '21-1103')).toBeUndefined();
    expect(
      posted()
        .lines.find((l) => l.accountCode === '51-1102')
        ?.dr.toFixed(2),
    ).toBe('36472.02');
    expect(posted().metadata).not.toHaveProperty('advanceRelief');
  });

  it('เงินรับล่วงหน้าถังรวม 500 + เงินเกินของลูกค้า 300 → หักทั้งสองก่อนคำนวณ: หนี้สูญ 18,190.00 − 800.00 = 17,390.00', async () => {
    const { template, client, posted } = build({
      gl: { ...STANDARD_1A, '21-1103': { cr: '500.00' }, '21-5101': { cr: '300.00' } },
      columns: { advanceBalance: '500.00', creditBalance: '300.00' },
    });

    const result = await template.execute({ contractId: 'contract-1' }, client as never);

    const lines = posted().lines;
    expect(
      tuples(lines.filter((l) => ['21-1103', '21-5101', '51-1102'].includes(l.accountCode))),
    ).toEqual(['21-1103 500.00 0.00', '21-5101 300.00 0.00', '51-1102 17390.00 0.00']);
    const dr = lines.reduce((s, l) => s.plus(l.dr), zero);
    const cr = lines.reduce((s, l) => s.plus(l.cr), zero);
    expect(dr.toFixed(2)).toBe(cr.toFixed(2));
    expect(posted().metadata).toMatchObject({ advanceRelief: '500.00', creditRelief: '300.00' });
    expect(result.creditRelief.toFixed(2)).toBe('300.00');
  });

  it('ค่าเผื่อหนี้สงสัยจะสูญใช้หักกับหนี้สูญหลังหักเงินของลูกค้า — ค่าเผื่อ 18,000 · เงินรับล่วงหน้า 500 → ใช้ค่าเผื่อ 17,690 คืน 310 ไม่มีหนี้สูญ', async () => {
    const { template, client, posted } = build({
      gl: { ...STANDARD_1A, '21-1103': { cr: '500.00' }, '11-2102': { cr: '18000.00' } },
      columns: { advanceBalance: '500.00' },
    });

    await template.execute({ contractId: 'contract-1' }, client as never);

    const lines = posted().lines;
    expect(
      tuples(lines.filter((l) => ['11-2102', '51-1103', '51-1102'].includes(l.accountCode))),
    ).toEqual(['11-2102 17690.00 0.00', '11-2102 310.00 0.00', '51-1103 0.00 310.00']);
    expect(posted().metadata).toMatchObject({
      provisionConsumed: '17690.00',
      releasedProvision: '310.00',
      writeOffExpense: '0.00',
      advanceRelief: '500.00',
    });
  });

  it('เงินของลูกค้ามากกว่าหนี้คงเหลือ → ปฏิเสธด้วยข้อความเดิม (loss ติดลบ) และไม่ลงรายการ', async () => {
    const { template, client, createAndPost } = build({
      gl: { ...STANDARD_1A, '21-5101': { cr: '20000.00' } },
      columns: { creditBalance: '20000.00' },
    });

    await expect(template.execute({ contractId: 'contract-1' }, client as never)).rejects.toThrow(
      /negative loss plug \(-1810\.00\)/,
    );
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('คอลัมน์ไม่ตรงบัญชี + ผู้เรียกส่งธุรกรรมมา → คืนสัญญาณเตือนให้ผู้เรียกส่งหลัง commit (template ยังไม่ส่ง)', async () => {
    const { template, client, posted } = build({
      gl: STANDARD_1A,
      columns: { creditBalance: '2000.00' },
    });

    const result = await template.execute({ contractId: 'contract-1' }, client as never);

    expect(posted().lines.find((l) => l.accountCode === '21-5101')).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      message: CLOSE_ADVANCE_MISMATCH_MESSAGE,
      tags: { flow: 'write-off' },
      extra: { contractId: 'contract-1', ledger21_5101: '0.00', creditBalance: '2000.00' },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ไม่ส่งธุรกรรม → template ส่งสัญญาณเตือนเองหลังลงรายการ (ระดับ warning) และคืนรายการว่าง', async () => {
    const { template } = build({ gl: STANDARD_1A, columns: { creditBalance: '2000.00' } });

    const result = await template.execute({ contractId: 'contract-1' });

    expect(result.warnings).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      CLOSE_ADVANCE_MISMATCH_MESSAGE,
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('ใบลดหนี้ VAT (ม.82/5) ของงวดที่ตั้งลูกหนี้งวดแล้วไม่เปลี่ยนเมื่อหักเงินรับล่วงหน้า — Dr 21-2101 99.17 เท่าเดิม หนี้สูญลดเท่ายอดที่หัก', async () => {
    const accrued = [
      {
        installmentNo: 1,
        accrualJournalEntryId: 'je-2a-1',
        dueDate: new Date(Date.UTC(2026, 8, 1)),
      },
    ];
    const gl: Gl = { '11-2103': { dr: '1515.83' } };
    const without = build({ gl });
    without.client.installmentSchedule.findMany.mockResolvedValue(accrued);
    await without.template.execute({ contractId: 'contract-1' }, without.client as never);
    const withAdvance = build({
      gl: { ...gl, '21-1103': { cr: '500.00' } },
      columns: { advanceBalance: '500.00' },
    });
    withAdvance.client.installmentSchedule.findMany.mockResolvedValue(accrued);
    await withAdvance.template.execute({ contractId: 'contract-1' }, withAdvance.client as never);

    expect(tuples(without.posted().lines)).toEqual([
      '21-2101 99.17 0.00',
      '11-2103 0.00 1515.83',
      '51-1102 1416.66 0.00',
    ]);
    expect(tuples(withAdvance.posted().lines)).toEqual([
      '21-2101 99.17 0.00',
      '11-2103 0.00 1515.83',
      '21-1103 500.00 0.00',
      '51-1102 916.66 0.00',
    ]);
    expect(withAdvance.posted().metadata).toMatchObject({
      creditNoteIssued: true,
      creditNoteVatAmount: '99.17',
    });
  });

  it('รายการตัดหนี้สูญของสัญญานี้มีอยู่แล้ว → คืนเลขเดิม ยอดหัก 0 ไม่มีสัญญาณเตือน ไม่ลงซ้ำ', async () => {
    const { template, client, createAndPost } = build({
      gl: { ...STANDARD_1A, '21-1103': { cr: '500.00' } },
      existingEntry: 'JE-OLD-1',
    });

    const result = await template.execute({ contractId: 'contract-1' }, client as never);

    expect(result.entryNo).toBe('JE-OLD-1');
    expect(result.advanceRelief.toFixed(2)).toBe('0.00');
    expect(result.creditRelief.toFixed(2)).toBe('0.00');
    expect(result.warnings).toEqual([]);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
