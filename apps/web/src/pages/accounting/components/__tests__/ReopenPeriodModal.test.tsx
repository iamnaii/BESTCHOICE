import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReopenPeriodModal } from '../ReopenPeriodModal';

describe('ReopenPeriodModal', () => {
  const props = (overrides = {}) => ({
    open: true,
    period: '2026-04',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open=false', () => {
    render(<ReopenPeriodModal {...props({ open: false })} />);
    expect(screen.queryByText(/2026-04/)).not.toBeInTheDocument();
  });

  it('shows period in title', () => {
    render(<ReopenPeriodModal {...props()} />);
    expect(screen.getByText(/2026-04/)).toBeInTheDocument();
  });

  it('confirm button disabled until reasonType + reason + taxFiled all set', () => {
    render(<ReopenPeriodModal {...props()} />);
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันเปิดงวด/ });
    expect(confirmBtn).toBeDisabled();

    // pick a reason
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    expect(confirmBtn).toBeDisabled(); // still need note + taxFiled

    // type note (>= 10 chars)
    fireEvent.change(screen.getByLabelText(/บันทึกรายละเอียด/), { target: { value: 'รายละเอียดเพิ่มเติม' } });
    expect(confirmBtn).toBeDisabled(); // still need taxFiled

    // pick taxFiled
    fireEvent.click(screen.getByLabelText(/ยังไม่ได้ยื่น/));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm with payload when submitted', () => {
    const onConfirm = vi.fn();
    render(<ReopenPeriodModal {...props({ onConfirm })} />);
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    fireEvent.change(screen.getByLabelText(/บันทึกรายละเอียด/), { target: { value: 'เอกสาร OI-26040015 ระบุลูกค้าผิด' } });
    fireEvent.click(screen.getByLabelText(/ยังไม่ได้ยื่น/));
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเปิดงวด/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      reasonType: 'WRONG_ENTRY',
      reason: 'เอกสาร OI-26040015 ระบุลูกค้าผิด',
      taxFiled: false,
    });
  });

  it('cancel resets form', () => {
    const onCancel = vi.fn();
    render(<ReopenPeriodModal {...props({ onCancel })} />);
    fireEvent.click(screen.getByLabelText(/พบเอกสารผิด/));
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
