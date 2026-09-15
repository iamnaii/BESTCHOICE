import { CreditCheckAiAnalysisService } from './credit-check-ai-analysis.service';
import { CreditCheckService } from '../credit-check.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiProviderService } from '../../ai-usage/ai-provider.service';
import type { AiUsageService } from '../../ai-usage/ai-usage.service';
import type { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../../customer-journey/journey-data-schemas';

const UPDATED_AT = new Date('2026-09-15T04:12:30.456Z');

function creditCheckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    customerId: 'customer-1',
    deletedAt: null,
    aiAnalysis: null,
    bankName: 'KBank',
    statementMonths: 3,
    statementFiles: ['a.jpg', 'b.jpg', 'c.jpg'],
    customer: { name: 'สมชาย ใจดี', salary: 30000, occupation: 'พนักงาน', occupationDetail: null },
    contract: { monthlyPayment: 6000, totalMonths: 12, financedAmount: 60000 },
    ...overrides,
  };
}

function build(options: { writer?: boolean; row?: unknown } = {}) {
  const db = {
    creditCheck: {
      findUnique: jest.fn().mockResolvedValue(options.row === undefined ? creditCheckRow() : options.row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cc-1',
        customerId: 'customer-1',
        ...data,
        updatedAt: UPDATED_AT,
      })),
    },
  };
  // getValue → null ⇒ ไม่มี Claude client ⇒ ทาง rule-based (ไม่ยิงเครือข่าย)
  const config = { getValue: jest.fn().mockResolvedValue(null) } as unknown as IntegrationConfigService;
  const provider = new AiProviderService({ record: jest.fn() } as unknown as AiUsageService);
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const writer = options.writer === false ? undefined : (journeyEntries as unknown as JourneyEntryWriter);
  const service = new CreditCheckAiAnalysisService(db as unknown as PrismaService, config, provider, writer);
  return { service, db, config, provider, writer, journeyEntries };
}

const EXPECTED_ENTRY = {
  customerId: 'customer-1',
  kind: 'CREDIT_AI_SCORED',
  occurredAt: UPDATED_AT,
  actorType: 'SYSTEM',
  actorUserId: null,
  refType: 'credit_check',
  refId: 'cc-1',
  // rule-based: 50 + ค่างวด 6000/30000 = 20% (+30) + statement 3 ไฟล์ (+10) + มีอาชีพ (+5) = 95 → APPROVED
  data: { score: 95, status: 'APPROVED' },
  dedupeKey: 'CREDIT_AI_SCORED:cc-1:2026-09-15T04:12:30.456Z',
};

type Variant = { label: string; run: (service: CreditCheckAiAnalysisService) => Promise<unknown> };
const VARIANTS: Variant[] = [
  { label: 'analyzeForCustomer', run: (service) => service.analyzeForCustomer('cc-1', 'sales-1') },
  { label: 'analyze', run: (service) => service.analyze('contract-1', 'sales-1') },
];

describe('CREDIT_AI_SCORED — ผล AI ประเมินเครดิตแต่ละรอบ', () => {
  it.each(VARIANTS)('$label → entry หลังเขียน status · เวลา = updatedAt ของรอบนี้ · ผู้กระทำ = ระบบ', async ({ run }) => {
    const { service, db, journeyEntries } = build();

    const res = await run(service);

    expect(res).toMatchObject({ id: 'cc-1', status: 'APPROVED', aiScore: 95 });
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(EXPECTED_ENTRY);
    expect(sanitizeJourneyData(EXPECTED_ENTRY.kind, EXPECTED_ENTRY.data)).toEqual({ ok: true, data: EXPECTED_ENTRY.data });
    expect(db.creditCheck.update.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('PDPA/การเงิน — data มีแค่คะแนนกับผล ไม่มีสรุป AI ชื่อ หรือรายได้', async () => {
    const { service, journeyEntries } = build();
    await service.analyzeForCustomer('cc-1', 'sales-1');
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(Object.keys(entry.data).sort()).toEqual(['score', 'status']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('สมชาย');
    expect(serialized).not.toContain('รายได้');
    expect(serialized).not.toContain('30,000');
  });

  it('วิเคราะห์ใหม่คนละรอบ → dedupeKey ต่างกันตาม updatedAt', async () => {
    const { service, db, journeyEntries } = build();
    await service.analyzeForCustomer('cc-1', 'sales-1');
    db.creditCheck.update.mockImplementationOnce(async ({ data }) => ({
      id: 'cc-1',
      customerId: 'customer-1',
      ...data,
      updatedAt: new Date('2026-09-16T01:00:00.000Z'),
    }));
    await service.analyzeForCustomer('cc-1', 'sales-1');
    expect(journeyEntries.recordAfterCommit.mock.calls.map(([entry]) => entry.dedupeKey)).toEqual([
      'CREDIT_AI_SCORED:cc-1:2026-09-15T04:12:30.456Z',
      'CREDIT_AI_SCORED:cc-1:2026-09-16T01:00:00.000Z',
    ]);
  });

  it('update ล้ม → ไม่เขียน entry', async () => {
    const { service, db, journeyEntries } = build();
    db.creditCheck.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.analyzeForCustomer('cc-1', 'sales-1')).rejects.toThrow('db down');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ใบจากสเตทเม้นในแชทถูกปฏิเสธก่อนวิเคราะห์ → ไม่เขียน entry', async () => {
    const { service, journeyEntries } = build({ row: creditCheckRow({ aiAnalysis: { source: 'chat-statement' } }) });
    await expect(service.analyzeForCustomer('cc-1', 'sales-1')).rejects.toThrow('รายการนี้อ่านจากสเตทเม้นในแชท');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง writer (เทสเดิมที่ประกอบ 3 อาร์กิวเมนต์) → วิเคราะห์ได้ตามเดิม', async () => {
    const { service, db } = build({ writer: false });
    await expect(service.analyze('contract-1')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(db.creditCheck.update).toHaveBeenCalledTimes(1);
  });

  it('CreditCheckService ส่ง writer ที่ Nest ฉีดให้ต่อไปยัง sub-service', async () => {
    const { db, config, provider, writer, journeyEntries } = build();
    const facade = new CreditCheckService(db as unknown as PrismaService, config, provider, writer);
    await facade.analyzeForCustomer('cc-1', 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(EXPECTED_ENTRY);
  });
});
