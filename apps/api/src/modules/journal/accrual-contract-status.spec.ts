import { ContractStatus } from '@prisma/client';
import {
  ACCRUAL_EXCLUDED_CONTRACT_STATUSES,
  isAccrualExcludedStatus,
} from './accrual-contract-status';

/**
 * สถานะสัญญาที่รอบตั้งลูกหนี้งวด (2A) ไม่ดูแล — รายการเดียวที่รอบกลางคืนและการตั้งลูกหนี้งวด
 * ณ วันรับเงินใช้ร่วมกัน (คำตัดสินผู้คุมงาน R1, 2026-09-29).
 */
describe('สถานะสัญญาที่รอบตั้งลูกหนี้งวดไม่ดูแล', () => {
  it('8 สถานะ: 6 สถานะเดิมของรอบกลางคืน (ลำดับเดิม) + DRAFT (ยังไม่เปิดใช้ ไม่มี 1A) + CANCELED (ยกเลิกสัญญาแล้ว)', () => {
    expect([...ACCRUAL_EXCLUDED_CONTRACT_STATUSES]).toEqual([
      'TERMINATED',
      'CLOSED_BAD_DEBT',
      'COMPLETED',
      'EARLY_PAYOFF',
      'EXCHANGED',
      'DEFECT_EXCHANGED',
      'DRAFT',
      'CANCELED',
    ]);
  });

  it.each<ContractStatus>(['ACTIVE', 'OVERDUE', 'DEFAULT'])('%s = สถานะที่ดูแล', (status) => {
    expect(isAccrualExcludedStatus(status)).toBe(false);
  });

  it.each<ContractStatus>([
    'TERMINATED',
    'CLOSED_BAD_DEBT',
    'COMPLETED',
    'EARLY_PAYOFF',
    'EXCHANGED',
    'DEFECT_EXCHANGED',
    'DRAFT',
    'CANCELED',
  ])('%s = สถานะที่ไม่ดูแล', (status) => {
    expect(isAccrualExcludedStatus(status)).toBe(true);
  });
});
