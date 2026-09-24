import { deriveStage, stageSince } from '../utils/after-sales-stage.util';

describe('deriveStage', () => {
  describe('REPAIR outcome (เหมือนเดิม — PR 1)', () => {
    it.each([
      [{ outcome: null, cancelledAt: null, closedAt: null, repairStatus: null }, 'RECEIVED'],
      [
        { outcome: 'REPAIR', cancelledAt: null, closedAt: null, repairStatus: 'OPEN' },
        'RECEIVED',
      ],
      [
        { outcome: 'REPAIR', cancelledAt: null, closedAt: null, repairStatus: 'IN_PROGRESS' },
        'IN_REPAIR',
      ],
      [
        {
          outcome: 'REPAIR',
          cancelledAt: null,
          closedAt: null,
          repairStatus: 'READY_FOR_PICKUP',
        },
        'READY_FOR_PICKUP',
      ],
      [
        { outcome: 'REPAIR', cancelledAt: null, closedAt: null, repairStatus: 'CLOSED' },
        'CLOSED',
      ],
      [
        { outcome: 'REPAIR', cancelledAt: null, closedAt: null, repairStatus: 'CANCELLED' },
        'CANCELLED',
      ], // ใบซ่อมถูกยกเลิกจากหน้าเก่า
      [
        {
          outcome: 'REPAIR',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          repairDeleted: true,
        },
        'CANCELLED',
      ], // ใบซ่อมถูกลบ
      [
        { outcome: 'REPAIR', cancelledAt: new Date(), closedAt: null, repairStatus: 'OPEN' },
        'CANCELLED',
      ],
    ] as const)('%j → %s', (input, expected) => {
      expect(deriveStage(input as never)).toBe(expected);
    });
  });

  describe('REPAIR + repairStatus=REPLACED (PR 2 — ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม, engine ตั้ง REPLACED + สัญญาใหม่)', () => {
    it.each([
      [
        {
          outcome: 'REPAIR',
          cancelledAt: null,
          closedAt: null,
          repairStatus: 'REPLACED',
          replacementContractId: null,
        },
        'AWAITING_APPROVAL',
      ],
      [
        {
          outcome: 'REPAIR',
          cancelledAt: null,
          closedAt: null,
          repairStatus: 'REPLACED',
          replacementContractId: 'ct-1',
        },
        'READY_FOR_PICKUP',
      ],
      [
        {
          outcome: 'REPAIR',
          cancelledAt: null,
          closedAt: new Date(),
          repairStatus: 'REPLACED',
          replacementContractId: 'ct-1',
        },
        'CLOSED',
      ],
    ] as const)('%j → %s', (input, expected) => {
      expect(deriveStage(input as never)).toBe(expected);
    });
  });

  describe('SAME_MODEL_EXCHANGE outcome', () => {
    it.each([
      [
        {
          outcome: 'SAME_MODEL_EXCHANGE',
          cancelledAt: new Date(),
          closedAt: null,
          repairStatus: null,
          replacementContractId: 'ct-1',
        },
        'CANCELLED',
      ], // cancelledAt ชนะทุกอย่าง แม้มี replacementContractId แล้ว
      [
        {
          outcome: 'SAME_MODEL_EXCHANGE',
          cancelledAt: null,
          closedAt: new Date(),
          repairStatus: null,
          replacementContractId: 'ct-1',
        },
        'CLOSED',
      ],
      [
        {
          outcome: 'SAME_MODEL_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          replacementContractId: 'ct-1',
        },
        'READY_FOR_PICKUP',
      ],
      [
        {
          outcome: 'SAME_MODEL_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          replacementContractId: null,
        },
        'AWAITING_APPROVAL',
      ],
    ] as const)('%j → %s', (input, expected) => {
      expect(deriveStage(input as never)).toBe(expected);
    });
  });

  describe('CASH_SAME_MODEL_EXCHANGE outcome (ยังไม่เปิด flow — คงค่าเดิม)', () => {
    it('ไม่มี replacementContractId/closedAt → AWAITING_APPROVAL เหมือน SAME_MODEL_EXCHANGE', () => {
      expect(
        deriveStage({
          outcome: 'CASH_SAME_MODEL_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          replacementContractId: null,
        } as never),
      ).toBe('AWAITING_APPROVAL');
    });
  });

  describe('PRICED_EXCHANGE outcome', () => {
    it.each([
      [
        { outcome: 'PRICED_EXCHANGE', cancelledAt: null, closedAt: null, repairStatus: null, exchange: null },
        'AWAITING_APPROVAL',
      ], // ยื่นไม่สำเร็จ/รอผูก exchangeRequestId
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'PENDING',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: null,
          },
        },
        'AWAITING_APPROVAL',
      ],
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'APPROVED',
            mode: 'MEMO',
            memoAppliedAt: new Date(),
            newContractStatus: null,
          },
        },
        'CLOSED',
      ],
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'APPROVED',
            mode: 'MEMO',
            memoAppliedAt: null,
            newContractStatus: null,
          },
        },
        'READY_FOR_PICKUP',
      ], // MEMO อนุมัติแล้วแต่ยังไม่ลงผล (ยังไม่ applied)
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'APPROVED',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: 'DRAFT',
          },
        },
        'READY_FOR_PICKUP',
      ], // สัญญาใหม่ถูกสร้างแต่ยังไม่เปิดใช้
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'APPROVED',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: 'ACTIVE',
          },
        },
        'CLOSED',
      ], // สัญญาใหม่เปิดใช้แล้ว
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'REJECTED',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: null,
          },
        },
        'CANCELLED',
      ],
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'CANCELED',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: null,
          },
        },
        'CANCELLED',
      ],
      [
        {
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: new Date(),
          closedAt: null,
          repairStatus: null,
          exchange: {
            status: 'APPROVED',
            mode: 'PRICED',
            memoAppliedAt: null,
            newContractStatus: 'ACTIVE',
          },
        },
        'CANCELLED',
      ], // cancelledAt ของเคสชนะทุกอย่าง แม้ exchange ฝั่งสัญญาใหม่จะดูปิดจบแล้วก็ตาม
    ] as const)('%j → %s', (input, expected) => {
      expect(deriveStage(input as never)).toBe(expected);
    });
  });
});

describe('deriveStage — I3 ยกเลิก swap หลังลงผล (เคสเคย CLOSED)', () => {
  it.each(['MEMO', 'PRICED'] as const)(
    '%s: คำขอ CANCELED แม้ closedAt ตั้งอยู่แล้ว (เคยปิด) → CANCELLED',
    (mode) => {
      expect(
        deriveStage({
          outcome: 'PRICED_EXCHANGE',
          cancelledAt: null,
          closedAt: new Date('2026-09-20T00:00:00Z'),
          repairStatus: null,
          exchange: {
            status: 'CANCELED',
            mode,
            memoAppliedAt: mode === 'MEMO' ? new Date('2026-09-20T00:00:00Z') : null,
            newContractStatus: mode === 'PRICED' ? 'CANCELED' : null,
          },
        }),
      ).toBe('CANCELLED');
    },
  );
});

describe('stageSince', () => {
  const receivedAt = new Date('2026-01-01T00:00:00.000Z');

  it('AWAITING_APPROVAL (ไม่มี repair ticket) → receivedAt', () => {
    expect(stageSince('AWAITING_APPROVAL', null, receivedAt)).toBe(receivedAt);
  });

  it('READY_FOR_PICKUP ของทางออกเปลี่ยนเครื่อง (ไม่มี repair ticket, มี approvedAt) → approvedAt', () => {
    const approvedAt = new Date('2026-01-05T00:00:00.000Z');
    expect(stageSince('READY_FOR_PICKUP', null, receivedAt, approvedAt)).toBe(approvedAt);
  });

  it('READY_FOR_PICKUP ไม่มี repair ticket และไม่มี approvedAt → fallback receivedAt', () => {
    expect(stageSince('READY_FOR_PICKUP', null, receivedAt)).toBe(receivedAt);
    expect(stageSince('READY_FOR_PICKUP', null, receivedAt, null)).toBe(receivedAt);
  });

  it('READY_FOR_PICKUP ของ REPAIR (มี repairedAt) ยังใช้ repairedAt เหมือนเดิม แม้ส่ง approvedAt มาด้วย', () => {
    const repairedAt = new Date('2026-01-03T00:00:00.000Z');
    const approvedAt = new Date('2026-01-05T00:00:00.000Z');
    expect(
      stageSince('READY_FOR_PICKUP', { sentToRepairAt: null, repairedAt }, receivedAt, approvedAt),
    ).toBe(repairedAt);
  });

  it('IN_REPAIR ใช้ sentToRepairAt เหมือนเดิม', () => {
    const sentToRepairAt = new Date('2026-01-02T00:00:00.000Z');
    expect(stageSince('IN_REPAIR', { sentToRepairAt, repairedAt: null }, receivedAt)).toBe(
      sentToRepairAt,
    );
  });
});
