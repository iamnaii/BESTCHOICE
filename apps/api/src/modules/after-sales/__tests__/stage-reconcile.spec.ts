import { reconcileStage, type ReconcilableCase } from '../services/after-sales-stage-reconcile';

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'as-1',
    stage: 'IN_REPAIR',
    outcome: 'REPAIR',
    cancelledAt: null,
    replacementContractId: null,
    repairTicket: { status: 'IN_PROGRESS', deletedAt: null },
    ...overrides,
  };
}

describe('reconcileStage — A1 final-fix brief (self-heal drifted AfterSalesCase.stage)', () => {
  let client: any;

  beforeEach(() => {
    client = {
      afterSalesCase: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  });

  it('ไม่มี drift (derived === stored) → ไม่เขียน DB เลย คืนแถวเดิม', async () => {
    const row = buildRow({ stage: 'IN_REPAIR', repairTicket: { status: 'IN_PROGRESS', deletedAt: null } });

    const result = await reconcileStage(client, row as ReconcilableCase);

    expect(client.afterSalesCase.updateMany).not.toHaveBeenCalled();
    expect(result).toBe(row); // อ้างอิงเดิม — ไม่แม้แต่ shallow-copy โดยไม่จำเป็น
  });

  it('มี drift (ตั๋วซ่อมถูกปิดนอก proxy) → CAS updateMany ด้วย where { id, stage: เดิม } + data.stage = derived + closedAt', async () => {
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      repairTicket: { status: 'CLOSED', deletedAt: null },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    expect(client.afterSalesCase.updateMany).toHaveBeenCalledTimes(1);
    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'as-1', stage: 'READY_FOR_PICKUP' });
    expect(arg.data.stage).toBe('CLOSED');
    expect(arg.data.closedAt).toBeInstanceOf(Date);
    expect(arg.data.cancelledAt).toBeUndefined();
    expect(result.stage).toBe('CLOSED');
  });

  it('drift ไปทาง CANCELLED (ใบซ่อมถูกลบนอก proxy) → data.cancelledAt ตั้งเมื่อยังไม่มี cancelledAt เดิม', async () => {
    const row = buildRow({
      stage: 'RECEIVED',
      repairTicket: { status: 'OPEN', deletedAt: true },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.stage).toBe('CANCELLED');
    expect(arg.data.cancelledAt).toBeInstanceOf(Date);
    expect(result.stage).toBe('CANCELLED');
  });

  it('CAS miss (count 0 — อีก request คู่แข่งชนะไปแล้ว) → ไม่ throw ยังคืน derived stage', async () => {
    client.afterSalesCase.updateMany.mockResolvedValue({ count: 0 });
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      repairTicket: { status: 'CLOSED', deletedAt: null },
    });

    await expect(reconcileStage(client, row as ReconcilableCase)).resolves.toMatchObject({ stage: 'CLOSED' });
  });

  it('ไม่เขียน audit — helper รับ client อย่างเดียว ไม่มี dependency กับ AuditService', () => {
    // ตรวจ signature ไม่มีพารามิเตอร์ audit/user — compile-time already enforces this,
    // เทสต์นี้เป็นเอกสารยืนยันเจตนา (self-healing bookkeeping ไม่ใช่ user action)
    expect(reconcileStage.length).toBeLessThanOrEqual(2);
  });
});
