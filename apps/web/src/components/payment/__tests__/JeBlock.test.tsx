import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JeBlock, journalFlowLabel, type ContractJe } from '../JeBlock';

const base: ContractJe = {
  id: 'je-1',
  entryNumber: 'JE-202609-0007',
  entryDate: '2026-09-05T00:00:00.000Z',
  postedAt: '2026-09-05T03:00:00.000Z',
  description: 'ยึดเครื่อง — สัญญา TEST-001 (8 งวดคงเหลือ)',
  paymentId: null,
  tag: 'JP5',
  flow: 'repossession',
  deltaApplied: null,
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    {
      accountCode: '11-1201',
      accountName: 'ธนาคาร KBank',
      debit: '7000.00',
      credit: '0.00',
      description: 'ราคากลางเครื่อง',
    },
    {
      accountCode: '11-2101',
      accountName: 'ลูกหนี้ผ่อนชำระ',
      debit: '0.00',
      credit: '7000.00',
      description: '',
    },
  ],
  totalDebit: '7000.00',
  totalCredit: '7000.00',
  isBalanced: true,
};

describe('journalFlowLabel', () => {
  it.each([
    [{ flow: 'receipt-void', tag: 'REVERSAL' }, 'กลับรายการ (VOID)', 'destructive'],
    [{ flow: 'contract-cancellation', tag: 'REVERSAL' }, 'กลับรายการ', 'destructive'],
    [{ flow: 'early-payoff', tag: 'JP4' }, 'JP4 — ปิดยอดก่อนกำหนด', 'default'],
    [{ flow: 'repossession', tag: 'JP5' }, 'JP5 — ยึดเครื่อง', 'default'],
    [{ flow: 'refund-payout', tag: 'REFUND_PAYOUT' }, 'จ่ายเงินคืนส่วนต่างลูกค้า', 'default'],
    [{ flow: 'refund-waive', tag: 'REFUND_WAIVED' }, 'ไม่คืนเงินส่วนต่าง → รายได้ยึด', 'default'],
    [
      { flow: 'shop-collect-settlement', tag: 'SCS' },
      'รับโอนจากหน้าร้าน (ล้าง 11-2107)',
      'default',
    ],
    [{ flow: 'shop-repossession-intake', tag: null }, 'SHOP — รับเครื่องยึดเข้าสต็อก', 'default'],
    [
      { flow: 'shop-collect-settlement-shop', tag: null },
      'SHOP — โอนให้ FINANCE (ล้าง S21-1104)',
      'default',
    ],
    [
      { flow: 'interco-recall-cash-shop', tag: null },
      'SHOP — คืนเงินเรียกคืนให้ FINANCE',
      'default',
    ],
    [{ flow: null, tag: '1A' }, 'เปิดสัญญา (1A)', 'default'],
    [{ flow: 'accrual', tag: '2A' }, 'รับรู้รายได้งวด (2A)', 'default'],
    [{ flow: 'payment-receipt', tag: '2B' }, 'รับชำระ (2B)', 'default'],
    [{ flow: null, tag: 'receipt' }, 'รับชำระ (2B)', 'default'],
    [{ flow: 'provision', tag: 'BAD-DEBT' }, 'ค่าเผื่อหนี้ / ตัดหนี้สูญ', 'default'],
    [{ flow: 'stage-reverse', tag: 'ECL-STAGE-REVERSE' }, 'กลับค่าเผื่อหนี้', 'default'],
    [{ flow: 'reschedule-collect', tag: '6a' }, 'ปรับดิว (JP6)', 'default'],
    [{ flow: 'shop-inventory-transfer-cogs', tag: null }, 'SHOP — โอนกรรมสิทธิ์/รายได้', 'default'],
    [{ flow: 'exchange-close-old-21-1106', tag: null }, 'เปลี่ยนเครื่อง', 'default'],
    [{ flow: 'something-new', tag: 'NEW_TAG' }, 'NEW_TAG', 'default'],
    [{ flow: null, tag: null }, 'อื่น ๆ', 'default'],
  ])('%o → %s', (je, label, tone) => {
    expect(journalFlowLabel(je)).toEqual({ label, tone });
  });
});

describe('JeBlock', () => {
  it('renders entry number, flow label, lines and balance', () => {
    render(<JeBlock je={base} />);
    expect(screen.getByText('JE-202609-0007')).toBeInTheDocument();
    expect(screen.getByText('JP5 — ยึดเครื่อง')).toBeInTheDocument();
    expect(screen.getByText('ธนาคาร KBank')).toBeInTheDocument();
    expect(screen.getByText(/BALANCED/)).toBeInTheDocument();
  });

  it('marks a reversal JE with the destructive label', () => {
    render(<JeBlock je={{ ...base, flow: 'receipt-void', tag: 'REVERSAL' }} />);
    expect(screen.getByText('กลับรายการ (VOID)')).toBeInTheDocument();
  });
});
