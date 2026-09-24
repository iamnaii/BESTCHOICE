import { reconcileStage, type ReconcilableCase } from '../services/after-sales-stage-reconcile';

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'as-1',
    stage: 'IN_REPAIR',
    outcome: 'REPAIR',
    cancelledAt: null,
    closedAt: null,
    replacementContractId: null,
    repairTicket: { status: 'IN_PROGRESS', deletedAt: null, returnedToCustomerAt: null },
    exchangeRequest: null,
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
    const row = buildRow({
      stage: 'IN_REPAIR',
      repairTicket: { status: 'IN_PROGRESS', deletedAt: null, returnedToCustomerAt: null },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    expect(client.afterSalesCase.updateMany).not.toHaveBeenCalled();
    expect(result).toBe(row); // อ้างอิงเดิม — ไม่แม้แต่ shallow-copy โดยไม่จำเป็น
  });

  it('มี drift (ตั๋วซ่อมถูกปิดนอก proxy, ไม่มี returnedToCustomerAt) → CAS updateMany ด้วย where { id, stage: เดิม } + data.stage = derived + closedAt = new Date() (fallback)', async () => {
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      repairTicket: { status: 'CLOSED', deletedAt: null, returnedToCustomerAt: null },
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

  it('(d) REPAIR ที่ ticket CLOSED มี returnedToCustomerAt จริง → closedAt = returnedToCustomerAt (R25 d) ไม่ใช่ new Date()', async () => {
    const returnedToCustomerAt = new Date('2026-09-10T03:00:00.000Z');
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      repairTicket: { status: 'CLOSED', deletedAt: null, returnedToCustomerAt },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.stage).toBe('CLOSED');
    expect(arg.data.closedAt).toBe(returnedToCustomerAt);
    expect(result.closedAt).toBe(returnedToCustomerAt);
  });

  it('drift ไปทาง CANCELLED (ใบซ่อมถูกลบนอก proxy) → data.cancelledAt ตั้งเมื่อยังไม่มี cancelledAt เดิม, ไม่มี exchangeRequest จึงไม่แตะ cancelReason', async () => {
    const row = buildRow({
      stage: 'RECEIVED',
      repairTicket: { status: 'OPEN', deletedAt: true, returnedToCustomerAt: null },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.stage).toBe('CANCELLED');
    expect(arg.data.cancelledAt).toBeInstanceOf(Date);
    expect(arg.data.cancelReason).toBeUndefined();
    expect(result.stage).toBe('CANCELLED');
  });

  it('CAS miss (count 0 — อีก request คู่แข่งชนะไปแล้ว) → ไม่ throw ยังคืน derived stage', async () => {
    client.afterSalesCase.updateMany.mockResolvedValue({ count: 0 });
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      repairTicket: { status: 'CLOSED', deletedAt: null, returnedToCustomerAt: null },
    });

    await expect(reconcileStage(client, row as ReconcilableCase)).resolves.toMatchObject({
      stage: 'CLOSED',
    });
  });

  it('ไม่เขียน audit — helper รับ client อย่างเดียว ไม่มี dependency กับ AuditService', () => {
    // ตรวจ signature ไม่มีพารามิเตอร์ audit/user — compile-time already enforces this,
    // เทสต์นี้เป็นเอกสารยืนยันเจตนา (self-healing bookkeeping ไม่ใช่ user action)
    expect(reconcileStage.length).toBeLessThanOrEqual(2);
  });

  // ===== PR 2 — deriveStage รุ่นสอง: reconcile อ่าน closedAt (คอลัมน์จริง) + exchangeRequest =====

  it('(a) PRICED_EXCHANGE stored AWAITING_APPROVAL แต่ request ถูก REJECTED นอก proxy → CAS เขียน CANCELLED + cancelledAt + cancelReason จาก rejectionReason', async () => {
    const row = buildRow({
      stage: 'AWAITING_APPROVAL',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      exchangeRequest: {
        status: 'REJECTED',
        mode: 'PRICED',
        memoAppliedAt: null,
        rejectionReason: 'สภาพเครื่องไม่ตรงที่แจ้ง',
        cancelReason: null,
        newContract: null,
      },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    expect(client.afterSalesCase.updateMany).toHaveBeenCalledTimes(1);
    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'as-1', stage: 'AWAITING_APPROVAL' });
    expect(arg.data.stage).toBe('CANCELLED');
    expect(arg.data.cancelledAt).toBeInstanceOf(Date);
    expect(arg.data.cancelReason).toBe('สภาพเครื่องไม่ตรงที่แจ้ง');
    expect(result.stage).toBe('CANCELLED');
  });

  it('(a2) PRICED_EXCHANGE ถูก CANCELED (ไม่มี rejectionReason แต่มี cancelReason ของคำขอ) → cancelReason จาก request.cancelReason', async () => {
    const row = buildRow({
      stage: 'AWAITING_APPROVAL',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      exchangeRequest: {
        status: 'CANCELED',
        mode: 'PRICED',
        memoAppliedAt: null,
        rejectionReason: null,
        cancelReason: 'ลูกค้าเปลี่ยนใจ',
        newContract: null,
      },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.cancelReason).toBe('ลูกค้าเปลี่ยนใจ');
    expect(result.stage).toBe('CANCELLED');
  });

  it('(a3) PRICED_EXCHANGE ถูกยกเลิกโดยไม่มีเหตุผลจากคำขอเลย → cancelReason ใช้ข้อความ default', async () => {
    const row = buildRow({
      stage: 'AWAITING_APPROVAL',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      exchangeRequest: {
        status: 'CANCELED',
        mode: 'PRICED',
        memoAppliedAt: null,
        rejectionReason: null,
        cancelReason: null,
        newContract: null,
      },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.cancelReason).toBe('คำขอเปลี่ยนเครื่องถูกยกเลิก');
    expect(result.stage).toBe('CANCELLED');
  });

  it('(b) PRICED_EXCHANGE stored READY_FOR_PICKUP แต่สัญญาใหม่เปิดใช้แล้ว (newContract.status=ACTIVE) → CAS เขียน CLOSED + closedAt (fallback new Date — ไม่มี repairTicket/memoAppliedAt)', async () => {
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      exchangeRequest: {
        status: 'APPROVED',
        mode: 'PRICED',
        memoAppliedAt: null,
        rejectionReason: null,
        cancelReason: null,
        newContract: { status: 'ACTIVE' },
      },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'as-1', stage: 'READY_FOR_PICKUP' });
    expect(arg.data.stage).toBe('CLOSED');
    expect(arg.data.closedAt).toBeInstanceOf(Date);
    expect(result.stage).toBe('CLOSED');
  });

  it('(b2) PRICED_EXCHANGE โหมด MEMO อนุมัติแล้วและ memoAppliedAt มีค่า → closedAt ใช้ memoAppliedAt เดิม ไม่ใช่ new Date()', async () => {
    const memoAppliedAt = new Date('2026-09-12T02:00:00.000Z');
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      exchangeRequest: {
        status: 'APPROVED',
        mode: 'MEMO',
        memoAppliedAt,
        rejectionReason: null,
        cancelReason: null,
        newContract: null,
      },
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.data.stage).toBe('CLOSED');
    expect(arg.data.closedAt).toBe(memoAppliedAt);
    expect(result.closedAt).toBe(memoAppliedAt);
  });

  it('(c) SAME_MODEL_EXCHANGE stored READY_FOR_PICKUP แต่ case.closedAt มีค่าจริงอยู่แล้ว (เขียนโดย flow อื่น) → CAS เขียน stage=CLOSED เท่านั้น ไม่แตะ/ทับ closedAt เดิม', async () => {
    const existingClosedAt = new Date('2026-09-01T00:00:00.000Z');
    const row = buildRow({
      stage: 'READY_FOR_PICKUP',
      outcome: 'SAME_MODEL_EXCHANGE',
      closedAt: existingClosedAt,
      replacementContractId: 'ct-9',
      repairTicket: null,
      exchangeRequest: null,
    });

    const result = await reconcileStage(client, row as ReconcilableCase);

    expect(client.afterSalesCase.updateMany).toHaveBeenCalledTimes(1);
    const arg = client.afterSalesCase.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'as-1', stage: 'READY_FOR_PICKUP' });
    expect(arg.data.stage).toBe('CLOSED');
    expect(arg.data.closedAt).toBeUndefined(); // ค่าเดิมของ row มีอยู่แล้ว ไม่ต้องเขียนทับ
    expect(result.closedAt).toBe(existingClosedAt);
  });
});
