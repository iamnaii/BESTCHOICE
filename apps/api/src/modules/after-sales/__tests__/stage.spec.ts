import { deriveStage } from '../utils/after-sales-stage.util';

describe('deriveStage', () => {
  it.each([
    [{ outcome: null, cancelledAt: null, repairStatus: null }, 'RECEIVED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'OPEN' }, 'RECEIVED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'IN_PROGRESS' }, 'IN_REPAIR'],
    [
      { outcome: 'REPAIR', cancelledAt: null, repairStatus: 'READY_FOR_PICKUP' },
      'READY_FOR_PICKUP',
    ],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'CLOSED' }, 'CLOSED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'REPLACED' }, 'CLOSED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'CANCELLED' }, 'CANCELLED'], // ใบซ่อมถูกยกเลิกจากหน้าเก่า
    [
      { outcome: 'REPAIR', cancelledAt: null, repairStatus: null, repairDeleted: true },
      'CANCELLED',
    ], // ใบซ่อมถูกลบ
    [{ outcome: 'REPAIR', cancelledAt: new Date(), repairStatus: 'OPEN' }, 'CANCELLED'],
    // R7 (controller ruling): backfill ของ Task 1 map ใบซ่อม REPLACED → outcome SAME_MODEL_EXCHANGE
    // + replacementContractId — PR 2 จะเพิ่มกิ่งอื่นของ SAME_MODEL_EXCHANGE (ยืนยัน/อนุมัติ) แทนที่นี่
    [
      {
        outcome: 'SAME_MODEL_EXCHANGE',
        cancelledAt: null,
        repairStatus: null,
        replacementContractId: 'ct-1',
      },
      'CLOSED',
    ],
    [
      {
        outcome: 'SAME_MODEL_EXCHANGE',
        cancelledAt: null,
        repairStatus: null,
        replacementContractId: null,
      },
      'AWAITING_APPROVAL',
    ],
  ] as const)('%j → %s', (input, expected) => {
    expect(deriveStage(input as never)).toBe(expected);
  });
});
