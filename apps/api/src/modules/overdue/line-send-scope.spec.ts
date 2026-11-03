import { collectionsSessionDay } from '../collections-session/collections-session.service';
import { lineSendContractScope, lineSendCustomerScope } from './line-send-scope';

/**
 * Task 29 #3 — ขอบเขตเดียวของ LINE การเงินจากหน้าจอทวงถาม: ปุ่ม "ส่ง LINE" (ระดับสัญญา) และแท็บ "แชท LINE" ของแผง 360 (ระดับลูกค้า —
 * ประกอบจากตัวระดับสัญญา ไม่มีกติกาชุดที่สอง) · พฤติกรรมบน Postgres ปักที่ `bulk.service.assigned-scope.db.spec.ts` +
 * `room-manager.customer-scope.db.spec.ts`
 */
describe('line-send-scope', () => {
  const now = new Date('2026-10-31T03:00:00.000Z');
  const assignedToday = {
    dailyAssignments: {
      some: { collectorId: 'u1', date: collectionsSessionDay(now), deletedAt: null },
    },
  };

  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s (ข้ามสาขา) → ไม่จำกัด', (role) => {
    const actor = { id: 'u1', role, branchId: 'b1' };
    expect(lineSendContractScope(actor, now)).toEqual({});
    expect(lineSendCustomerScope(actor, now)).toEqual({});
  });

  it('BM/SALES มีสาขา → สัญญาในสาขา หรือ งานรายวันวันนี้ · ลูกค้า = มีสัญญาที่ไม่ถูกลบในขอบเขตนั้น', () => {
    const actor = { id: 'u1', role: 'SALES', branchId: 'b1' };
    const contractScope = { OR: [{ branchId: 'b1' }, assignedToday] };
    expect(lineSendContractScope(actor, now)).toEqual(contractScope);
    expect(lineSendCustomerScope(actor, now)).toEqual({
      contracts: { some: { deletedAt: null, ...contractScope } },
    });
  });

  it('ไม่มีสาขา → เฉพาะงานรายวันวันนี้ (fail closed)', () => {
    const actor = { id: 'u1', role: 'BRANCH_MANAGER', branchId: null };
    expect(lineSendCustomerScope(actor, now)).toEqual({
      contracts: { some: { deletedAt: null, OR: [assignedToday] } },
    });
  });
});
