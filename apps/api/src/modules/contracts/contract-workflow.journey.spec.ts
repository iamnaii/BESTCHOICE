import { ContractWorkflowService } from './contract-workflow.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

jest.mock('../../utils/validation.util', () => ({
  ...jest.requireActual('../../utils/validation.util'),
  checkAgeEligibility: jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false }),
  checkRequiredDocuments: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
  checkRequiredSignatures: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
}));

const REVIEW_NOTE = 'บัตรไม่ชัด โทรกลับ 081-234-5678';

function pendingContract() {
  return {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    salespersonId: 'sales-1',
    workflowStatus: 'PENDING_REVIEW',
    status: 'DRAFT',
    contractHash: null,
    deletedAt: null,
    customer: { birthDate: null, phone: '0812345678', nationalId: '1234567890123' },
    signatures: [],
    contractDocuments: [],
    creditCheck: null,
  };
}

function build(withWriter = true) {
  const prisma = {
    contract: {
      findUnique: jest.fn().mockResolvedValue(pendingContract()),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const stub = {} as never;
  const service = new ContractWorkflowService(
    prisma as unknown as PrismaService,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    undefined,
    withWriter ? (journeyEntries as unknown as JourneyEntryWriter) : undefined,
  );
  return { service, prisma, journeyEntries };
}

describe('ContractWorkflowService — CONTRACT_REVIEWED ทุกรอบ', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-09-15T03:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('อนุมัติ → entry ใช้ reviewedAt ตัวเดียวกับที่เขียนลงสัญญา ผู้ตรวจเป็น STAFF และเขียนหลัง update', async () => {
    const { service, prisma, journeyEntries } = build();

    await service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER', 'เอกสารครบ');

    const reviewedAt: Date = prisma.contract.update.mock.calls[0][0].data.reviewedAt;
    expect(reviewedAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'customer-1',
      kind: 'CONTRACT_REVIEWED',
      occurredAt: reviewedAt,
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      refType: 'contract',
      refId: 'contract-1',
      data: { decision: 'APPROVED', contractNumber: 'BC-2026-001' },
      dedupeKey: 'CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z',
    });
    const reviewed = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(sanitizeJourneyData(reviewed.kind, reviewed.data)).toEqual({ ok: true, data: reviewed.data });
    expect(prisma.contract.update.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('ตีกลับ → decision REJECTED และไม่คัดลอกหมายเหตุ (ข้อความอิสระอาจมีเบอร์)', async () => {
    const { service, journeyEntries } = build();

    await service.rejectContract('contract-1', 'fm-1', 'FINANCE_MANAGER', REVIEW_NOTE);

    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(entry).toMatchObject({
      kind: 'CONTRACT_REVIEWED',
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      data: { decision: 'REJECTED', contractNumber: 'BC-2026-001' },
      dedupeKey: 'CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z',
    });
    expect(Object.keys(entry.data).sort()).toEqual(['contractNumber', 'decision']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('081-234-5678');
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('1234567890123');
  });

  it('ตีกลับ แล้วส่งใหม่ แล้วอนุมัติ → 2 entry คนละ dedupeKey (skipDuplicates ไม่กลืนรอบหลัง)', async () => {
    const { service, journeyEntries } = build();

    await service.rejectContract('contract-1', 'fm-1', 'FINANCE_MANAGER', 'แก้ที่อยู่ตามบัตร');
    jest.setSystemTime(new Date('2026-09-16T08:30:00.000Z'));
    await service.approveContract('contract-1', 'owner-1', 'OWNER');

    const keys = journeyEntries.recordAfterCommit.mock.calls.map(([entry]) => entry.dedupeKey);
    expect(keys).toEqual(['CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z', 'CONTRACT_REVIEWED:contract-1:2026-09-16T08:30:00.000Z']);
    expect(journeyEntries.recordAfterCommit.mock.calls[1][0]).toMatchObject({ actorUserId: 'owner-1', data: { decision: 'APPROVED' } });
  });

  it('ผู้ขายตีกลับสัญญาตัวเอง (Forbidden) → ไม่ update และไม่เขียน entry', async () => {
    const { service, prisma, journeyEntries } = build();
    await expect(service.rejectContract('contract-1', 'sales-1', 'SALES', 'ขอแก้')).rejects.toThrow('ไม่สามารถปฏิเสธสัญญาที่ตัวเองสร้างได้');
    expect(prisma.contract.update).not.toHaveBeenCalled();
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('เขียนสัญญาไม่สำเร็จ → ไม่เขียน entry', async () => {
    const { service, prisma, journeyEntries } = build();
    prisma.contract.update.mockRejectedValue(new Error('db down'));
    await expect(service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER')).rejects.toThrow('db down');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่มี JourneyEntryWriter (เทสเดิมที่ประกอบ service เอง) → อนุมัติได้ตามเดิม', async () => {
    const { service, prisma } = build(false);
    await expect(service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER')).resolves.toBeDefined();
    expect(prisma.contract.update).toHaveBeenCalledTimes(1);
  });
});
