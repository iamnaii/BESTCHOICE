import { summarizeContractPayments } from './products-active-contract.util';

describe('summarizeContractPayments', () => {
  it('นับงวดที่ PAID และงวดถัดไป = dueDate ต่ำสุดของงวดที่ยังไม่ PAID (ไม่สนลำดับที่ส่งมา)', () => {
    const r = summarizeContractPayments([
      { status: 'PAID', dueDate: new Date('2026-10-05T00:00:00Z') },
      { status: 'PENDING', dueDate: new Date('2026-12-05T00:00:00Z') },
      { status: 'OVERDUE', dueDate: new Date('2026-11-05T00:00:00Z') },
    ]);
    expect(r).toEqual({ paidInstallments: 1, nextDueDate: new Date('2026-11-05T00:00:00Z') });
  });

  it('ชำระครบทุกงวด → nextDueDate = null', () => {
    const r = summarizeContractPayments([
      { status: 'PAID', dueDate: new Date('2026-10-05T00:00:00Z') },
      { status: 'PAID', dueDate: new Date('2026-11-05T00:00:00Z') },
    ]);
    expect(r).toEqual({ paidInstallments: 2, nextDueDate: null });
  });

  it('ไม่มีงวดเลย → 0 / null', () => {
    expect(summarizeContractPayments([])).toEqual({ paidInstallments: 0, nextDueDate: null });
  });
});
