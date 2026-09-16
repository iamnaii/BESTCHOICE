import { readFileSync } from 'fs';
import { join } from 'path';
import { JOURNEY_STAGES, STAGE_LABELS } from '@installment/shared';
import {
  buildJourneySummary,
  firstSourceLabel,
  postSaleBadges,
  UNBUY_FALLBACK_STAGES,
  withLiveBought,
  type JourneyStateRow,
  type JourneySummaryExtras,
} from './journey-summary.builder';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const d = (iso: string) => new Date(iso);

function row(over: Partial<JourneyStateRow> = {}): JourneyStateRow {
  return {
    stage: 'CREDIT', stageEnteredAt: d('2026-09-10T05:00:00.000Z'), path: 'INSTALLMENT',
    contactedAt: d('2026-09-01T05:00:00.000Z'), identifiedAt: d('2026-09-03T05:00:00.000Z'), interestedAt: null,
    creditAt: d('2026-09-10T05:00:00.000Z'), firstPurchaseAt: null, firstStaffReplyAt: d('2026-09-01T06:00:00.000Z'),
    firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null, heardFrom: null,
    lastCustomerAt: d('2026-09-12T05:00:00.000Z'), lastTouchAt: null, lostAt: null, lostReason: null,
    computedAt: d('2026-09-15T04:59:00.000Z'), ...over,
  };
}
const extras: JourneySummaryExtras = { firstAd: null, interestedByManualEntry: false, creditRejected: false, postSaleBadges: [] };

describe('buildJourneySummary', () => {
  it('ขั้น CREDIT (③): ก่อนหน้ามีเวลา=done · ถัดไป (④ นัด / จอง, ⑤) = todo ไม่มีวันที่ · ค้างขั้น/เงียบเป็นวันเต็ม', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s.steps.map((x) => [x.stage, x.state, x.at])).toEqual([
      ['CONTACTED', 'done', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'done', '2026-09-03T05:00:00.000Z'],
      ['CREDIT', 'current', '2026-09-10T05:00:00.000Z'], ['INTERESTED', 'todo', null], ['PURCHASED', 'todo', null],
    ]);
    expect(s.steps.map((x) => x.label)).toEqual(JOURNEY_STAGES.map((k) => STAGE_LABELS[k]));
    expect(s).toMatchObject({
      stage: 'CREDIT', stageLabel: STAGE_LABELS.CREDIT, stageEnteredAt: '2026-09-10T05:00:00.000Z', daysInStage: 5,
      path: 'INSTALLMENT', firstSourceLabel: 'แชท Facebook', contactedAt: '2026-09-01T05:00:00.000Z',
      firstStaffReplyAt: '2026-09-01T06:00:00.000Z', firstPurchaseAt: null, silentDays: 3, lost: null,
      postSaleBadges: [], creditRejected: false,
    });
  });

  it('ซื้อเงินสดโดยไม่ตรวจเครดิต → CREDIT=skipped · silentDays=null · ป้ายหลังการขายแสดง · creditRejected ถูกปิด', () => {
    const s = buildJourneySummary(
      row({ stage: 'PURCHASED', path: 'CASH', creditAt: null, firstPurchaseAt: d('2026-09-14T05:00:00.000Z'), stageEnteredAt: d('2026-09-14T05:00:00.000Z') }),
      { ...extras, creditRejected: true, postSaleBadges: ['ซื้อซ้ำ'] },
      NOW,
    );
    expect(s.steps.find((x) => x.stage === 'CREDIT')?.state).toBe('skipped');
    expect(s.steps.find((x) => x.stage === 'PURCHASED')).toMatchObject({ state: 'current', at: '2026-09-14T05:00:00.000Z' });
    expect(s).toMatchObject({ silentDays: null, postSaleBadges: ['ซื้อซ้ำ'], creditRejected: false, daysInStage: 1 });
  });

  it('นัด / จอง จากบันทึกมือโดยไม่มีหลักฐานตรวจเครดิต → ③ skipped · ④ current + MANUAL เฉพาะขั้นนั้น · ป้ายหลุดมีเหตุผล', () => {
    const s = buildJourneySummary(
      row({ stage: 'INTERESTED', interestedAt: d('2026-09-05T05:00:00.000Z'), creditAt: null, lostAt: d('2026-09-13T05:00:00.000Z'), lostReason: 'UNREACHABLE' }),
      { ...extras, interestedByManualEntry: true },
      NOW,
    );
    expect(s.steps.map((x) => [x.stage, x.state])).toEqual([
      ['CONTACTED', 'done'], ['IDENTIFIED', 'done'], ['CREDIT', 'skipped'], ['INTERESTED', 'current'], ['PURCHASED', 'todo'],
    ]);
    expect(s.steps.filter((x) => x.evidence === 'MANUAL').map((x) => x.stage)).toEqual(['INTERESTED']);
    expect(s.lost).toEqual({ at: '2026-09-13T05:00:00.000Z', reason: 'UNREACHABLE' });
  });

  it('stage ชนะเวลาที่แช่แข็ง: ลบเบอร์แล้ว stage=CONTACTED แต่ identifiedAt ยังอยู่ → IDENTIFIED เป็น todo ไม่แสดงวันที่', () => {
    const s = buildJourneySummary(
      row({ stage: 'CONTACTED', stageEnteredAt: d('2026-09-01T05:00:00.000Z'), creditAt: null }),
      extras,
      NOW,
    );
    expect(s.steps.map((x) => [x.stage, x.state, x.at])).toEqual([
      ['CONTACTED', 'current', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'todo', null], ['CREDIT', 'todo', null],
      ['INTERESTED', 'todo', null], ['PURCHASED', 'todo', null],
    ]);
  });

  it('ธงเฟส 3 มีในคำตอบเสมอ: askHeardFrom / creditFilePending เป็น false สำหรับลูกค้าที่เริ่มจากแชทและไม่มีไฟล์รอตรวจ', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s).toHaveProperty('askHeardFrom', false);
    expect(s).toHaveProperty('creditFilePending', false);
  });
});

describe('ลำดับขั้น ③ ตรวจเครดิต → ④ นัด / จอง (เจ้าของสั่ง 2026-09-15)', () => {
  it('JOURNEY_STAGES + STAGE_LABELS เรียงใหม่ · ขั้น 4 ชื่อ "นัด / จอง" (spec ของ shared ไม่รันใน CI จึงปักซ้ำที่นี่)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.CREDIT).toBe('ตรวจเครดิต');
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
  });

  it('มีทั้งใบตรวจเครดิตและนัด → ขั้นปัจจุบัน นัด / จอง · ตรวจเครดิต done พร้อมวันที่ แม้ตรวจทีหลังนัด (วันที่บนแถบไม่เรียงได้)', () => {
    const s = buildJourneySummary(
      row({
        stage: 'INTERESTED',
        stageEnteredAt: d('2026-09-05T05:00:00.000Z'),
        interestedAt: d('2026-09-05T05:00:00.000Z'),
        creditAt: d('2026-09-10T05:00:00.000Z'),
      }),
      extras,
      NOW,
    );
    expect(s.steps.map((x) => [x.stage, x.state, x.at])).toEqual([
      ['CONTACTED', 'done', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'done', '2026-09-03T05:00:00.000Z'],
      ['CREDIT', 'done', '2026-09-10T05:00:00.000Z'], ['INTERESTED', 'current', '2026-09-05T05:00:00.000Z'], ['PURCHASED', 'todo', null],
    ]);
    expect(s).toMatchObject({ stage: 'INTERESTED', stageLabel: 'นัด / จอง', daysInStage: 10 });
  });

  it('ใบจอง/นัดอย่างเดียว ไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิต skipped ไม่มีวันที่ · นัด / จอง current', () => {
    const s = buildJourneySummary(
      row({
        stage: 'INTERESTED',
        path: 'UNKNOWN',
        stageEnteredAt: d('2026-09-08T05:00:00.000Z'),
        interestedAt: d('2026-09-08T05:00:00.000Z'),
        creditAt: null,
      }),
      extras,
      NOW,
    );
    expect(s.steps.find((x) => x.stage === 'CREDIT')).toMatchObject({ state: 'skipped', at: null, evidence: 'SYSTEM' });
    expect(s.steps.find((x) => x.stage === 'INTERESTED')).toMatchObject({ state: 'current', at: '2026-09-08T05:00:00.000Z' });
  });

  it('journey-state.sql จัดอันดับ stage ตรงกับ JOURNEY_STAGES (สูง → ต่ำ) และ UNBUY_FALLBACK_STAGES — ห้ามเขียนลำดับแยกกัน', () => {
    const sql = readFileSync(join(__dirname, 'sql', 'journey-state.sql'), 'utf8');
    const stageCase = /CASE WHEN s\.bought THEN 'PURCHASED'([\s\S]*?)ELSE 'CONTACTED' END AS stage/.exec(sql);
    expect(stageCase).not.toBeNull();
    const ranked = [...(stageCase?.[1] ?? '').matchAll(/THEN '([A-Z]+)'/g)].map((match) => match[1]);
    expect(ranked).toEqual([...UNBUY_FALLBACK_STAGES]);
    expect(['PURCHASED', ...ranked, 'CONTACTED']).toEqual([...JOURNEY_STAGES].reverse());
  });
});

describe('withLiveBought', () => {
  it('แคชยังไม่ซื้อแต่ BOUGHT สดเป็นจริง → PURCHASED (ไม่มี firstPurchaseAt ใช้ now)', () => {
    expect(withLiveBought(row(), true, NOW)).toMatchObject({ stage: 'PURCHASED', stageEnteredAt: NOW });
  });
  it('แคชซื้อแล้วแต่ยกเลิกใบขายจน BOUGHT เป็นเท็จ → ถอยไปขั้นสูงสุดที่มีเวลา ตามลำดับ นัด / จอง → ตรวจเครดิต → ได้เบอร์ → ทักเข้ามา · ล้าง firstPurchaseAt', () => {
    const bought: Partial<JourneyStateRow> = { stage: 'PURCHASED', firstPurchaseAt: d('2026-09-14T05:00:00.000Z') };
    const cases: Array<[Partial<JourneyStateRow>, string, string]> = [
      [{ interestedAt: d('2026-09-05T05:00:00.000Z'), creditAt: d('2026-09-10T05:00:00.000Z') }, 'INTERESTED', '2026-09-05T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: d('2026-09-10T05:00:00.000Z') }, 'CREDIT', '2026-09-10T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: null }, 'IDENTIFIED', '2026-09-03T05:00:00.000Z'],
      [{ interestedAt: null, creditAt: null, identifiedAt: null }, 'CONTACTED', '2026-09-01T05:00:00.000Z'],
    ];
    for (const [over, stage, enteredAt] of cases) {
      const r = withLiveBought(row({ ...bought, ...over }), false, NOW);
      expect({ stage: r.stage, stageEnteredAt: r.stageEnteredAt.toISOString(), firstPurchaseAt: r.firstPurchaseAt }).toEqual({
        stage,
        stageEnteredAt: enteredAt,
        firstPurchaseAt: null,
      });
    }
  });
  it('ลำดับถอยกลับมาจาก JOURNEY_STAGES กลับด้าน ไม่รวมซื้อแล้ว/ทักเข้ามา — เปลี่ยนลำดับขั้นที่ shared ที่เดียว', () => {
    expect(UNBUY_FALLBACK_STAGES).toEqual(['INTERESTED', 'CREDIT', 'IDENTIFIED']);
  });
  it('ตรงกันอยู่แล้ว → คืนแถวเดิม', () => {
    const r = row();
    expect(withLiveBought(r, false, NOW)).toBe(r);
  });
});

describe('firstSourceLabel / postSaleBadges', () => {
  it('ป้ายที่มา (คำเดียวกับ SOURCE_LABELS ของเว็บ)', () => {
    expect(firstSourceLabel('AD:1203', { name: 'iPhone ผ่อน 0%' })).toBe('โฆษณา: iPhone ผ่อน 0%');
    expect(firstSourceLabel('HEARD:FRIEND', null)).toBe('ลูกค้าบอกว่ารู้จักจาก เพื่อนแนะนำ');
    expect(firstSourceLabel('CHAT_LINE_SHOP', null)).toBe('แชท LINE ร้าน');
    expect(firstSourceLabel('REFERRAL', null)).toBe('คนแนะนำ');
    expect(firstSourceLabel('WALK_IN', null)).toBe('หน้าร้าน');
  });
  it('ป้ายหลังการขาย: สัญญาล่าสุด → ซื้อซ้ำ → ใบซ่อม → ติดตามตัวไม่ได้', () => {
    expect(postSaleBadges({ latestContractStatus: 'OVERDUE', purchaseCount: 2, hasRepairTicket: true, skipTracingLost: true }))
      .toEqual(['ค้างชำระ', 'ซื้อซ้ำ', 'มีใบซ่อม', 'ติดตามตัวไม่ได้']);
    expect(postSaleBadges({ latestContractStatus: 'EARLY_PAYOFF', purchaseCount: 1, hasRepairTicket: false, skipTracingLost: false })).toEqual(['ปิดสัญญาแล้ว']);
    expect(postSaleBadges({ latestContractStatus: null, purchaseCount: 1, hasRepairTicket: false, skipTracingLost: false })).toEqual([]);
  });
});
