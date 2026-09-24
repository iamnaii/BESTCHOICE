import { Prisma } from '@prisma/client';
import { ContractsController } from './contracts.controller';
import type { ContractsService } from './contracts.service';
import type { ContractWorkflowService } from './contract-workflow.service';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

const USER = { id: 'fm-1', role: 'FINANCE_MANAGER', branchId: 'branch-1' };
const ACTIVATED = {
  id: 'contract-1',
  contractNumber: 'BC-2026-001',
  customerId: 'customer-1',
  status: 'ACTIVE',
  totalMonths: 12,
  monthlyPayment: new Prisma.Decimal('1813.00'),
  customer: { phone: '0812345678', nationalId: '1234567890123', addressCurrent: 'บ้านเลขที่ 9 ถนนพหลโยธิน' },
};

function build() {
  const contractsService = { findOne: jest.fn().mockResolvedValue({ id: 'contract-1' }) };
  const workflowService = { activate: jest.fn().mockResolvedValue(ACTIVATED) };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const controller = new ContractsController(
    contractsService as unknown as ContractsService,
    workflowService as unknown as ContractWorkflowService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    journeyEntries as unknown as JourneyEntryWriter,
    {} as never, // EarlyPayoffSlipService — ไม่ใช้ใน spec นี้
  );
  return { controller, contractsService, workflowService, journeyEntries };
}

describe('ContractsController.activate — บันทึก CONTRACT_ACTIVATED หลัง commit', () => {
  it('เปิดสัญญาสำเร็จ → เขียน entry หนึ่งแถว ผูกผู้กดเปิด และคืนผลของ activate เดิม', async () => {
    const { controller, contractsService, workflowService, journeyEntries } = build();
    const before = Date.now();

    const res = await controller.activate('contract-1', USER);

    expect(res).toBe(ACTIVATED);
    expect(contractsService.findOne).toHaveBeenCalledWith('contract-1', USER);
    expect(workflowService.activate).toHaveBeenCalledWith('contract-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(entry).toEqual({
      customerId: 'customer-1',
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: expect.any(Date),
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      refType: 'contract',
      refId: 'contract-1',
      data: { contractNumber: 'BC-2026-001', totalMonths: 12, monthlyPayment: 1813 },
      dedupeKey: 'CONTRACT_ACTIVATED:contract-1',
    });
    expect(sanitizeJourneyData(entry.kind, entry.data)).toEqual({ ok: true, data: entry.data });
    expect(entry.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(workflowService.activate.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('PDPA — entry ไม่มีเบอร์ เลขบัตร หรือที่อยู่ของลูกค้า', async () => {
    const { controller, journeyEntries } = build();
    await controller.activate('contract-1', USER);
    const serialized = JSON.stringify(journeyEntries.recordAfterCommit.mock.calls[0][0]);
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('1234567890123');
    expect(serialized).not.toContain('บ้านเลขที่');
  });

  it('activate ล้ม (เช่นสัญญายังไม่อนุมัติ) → ไม่เขียน entry และโยน error เดิม', async () => {
    const { controller, workflowService, journeyEntries } = build();
    workflowService.activate.mockRejectedValue(new Error('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน'));
    await expect(controller.activate('contract-1', USER)).rejects.toThrow('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ด่านสาขาไม่ผ่าน → ไม่เรียก activate และไม่เขียน entry', async () => {
    const { controller, contractsService, workflowService, journeyEntries } = build();
    contractsService.findOne.mockRejectedValue(new Error('ไม่พบสัญญา'));
    await expect(controller.activate('contract-1', USER)).rejects.toThrow('ไม่พบสัญญา');
    expect(workflowService.activate).not.toHaveBeenCalled();
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });
});
