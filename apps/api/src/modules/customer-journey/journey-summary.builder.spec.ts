import { JOURNEY_STAGES, STAGE_LABELS } from '@installment/shared';
import {
  buildJourneySummary,
  firstSourceLabel,
  postSaleBadges,
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
  it('ขั้น CREDIT: ก่อนหน้ามีเวลา=done ไม่มีเวลา=skipped · ถัดไป=todo · ค้างขั้น/เงียบเป็นวันเต็ม', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s.steps.map((x) => [x.stage, x.state])).toEqual([
      ['CONTACTED', 'done'], ['IDENTIFIED', 'done'], ['INTERESTED', 'skipped'], ['CREDIT', 'current'], ['PURCHASED', 'todo'],
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

  it('หลักฐานขั้นสนใจมาจากบันทึกมือ → MANUAL เฉพาะขั้นนั้น · ป้ายหลุดมีเหตุผล', () => {
    const s = buildJourneySummary(
      row({ stage: 'INTERESTED', interestedAt: d('2026-09-05T05:00:00.000Z'), creditAt: null, lostAt: d('2026-09-13T05:00:00.000Z'), lostReason: 'UNREACHABLE' }),
      { ...extras, interestedByManualEntry: true },
      NOW,
    );
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
      ['CONTACTED', 'current', '2026-09-01T05:00:00.000Z'], ['IDENTIFIED', 'todo', null], ['INTERESTED', 'todo', null],
      ['CREDIT', 'todo', null], ['PURCHASED', 'todo', null],
    ]);
  });
});

describe('withLiveBought', () => {
  it('แคชยังไม่ซื้อแต่ BOUGHT สดเป็นจริง → PURCHASED (ไม่มี firstPurchaseAt ใช้ now)', () => {
    expect(withLiveBought(row(), true, NOW)).toMatchObject({ stage: 'PURCHASED', stageEnteredAt: NOW });
  });
  it('แคชซื้อแล้วแต่ยกเลิกใบขายจน BOUGHT เป็นเท็จ → ถอยไปขั้นสูงสุดที่มีเวลา ล้าง firstPurchaseAt', () => {
    const r = withLiveBought(row({ stage: 'PURCHASED', firstPurchaseAt: d('2026-09-14T05:00:00.000Z') }), false, NOW);
    expect(r).toMatchObject({ stage: 'CREDIT', stageEnteredAt: d('2026-09-10T05:00:00.000Z'), firstPurchaseAt: null });
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
