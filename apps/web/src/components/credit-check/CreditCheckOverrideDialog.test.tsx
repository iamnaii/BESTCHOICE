import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CreditCheckOverrideDialog from './CreditCheckOverrideDialog';

it('allows reviewing an already-approved FULL check while requiring a fresh amount', () => {
  const props = { open: true, onClose: vi.fn(), aiDecision: 'APPROVED', aiSummary: null,
    status: 'APPROVED', onStatusChange: vi.fn(), reasonCategory: 'OTHER', onReasonCategoryChange: vi.fn(),
    notes: 'ทบทวนรายได้และค่าใช้จ่ายจากเอกสารชุดใหม่ของลูกค้า', onNotesChange: vi.fn(),
    isPending: false, onConfirm: vi.fn(), creditCheckId: 'check', checkType: 'FULL' };
  render(<CreditCheckOverrideDialog {...props} />);
  expect(screen.getByLabelText(/รายได้ประจำที่ยืนยัน/)).toBeInTheDocument();
  expect(screen.queryByText(/สถานะนี้เหมือนสถานะปัจจุบัน/)).not.toBeInTheDocument();
});
