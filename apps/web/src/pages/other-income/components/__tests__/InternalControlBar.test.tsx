import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InternalControlBar } from '../InternalControlBar';

describe('InternalControlBar', () => {
  const handlers = {
    onCancel: vi.fn(),
    onSaveDraft: vi.fn(),
    onPost: vi.fn(),
    onSubmitForApproval: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onReverse: vi.fn(),
  };

  beforeEach(() => {
    Object.values(handlers).forEach((h) => h.mockClear());
  });

  const baseProps = {
    recorder: { name: 'เอกนรินทร์' },
    approver: { name: 'เอกนรินทร์' },
    makerCheckerEnabled: false,
    ...handlers,
  };

  it('renders ผู้บันทึก + ผู้อนุมัติ pills always', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    expect(screen.getByText(/ผู้บันทึก:/)).toBeInTheDocument();
    expect(screen.getByText(/ผู้อนุมัติ:/)).toBeInTheDocument();
    expect(screen.getAllByText('เอกนรินทร์')).toHaveLength(2);
  });

  it('does NOT show "ต้องอนุมัติ" badge when Maker-Checker disabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={false} />);
    expect(screen.queryByText('ต้องอนุมัติ')).not.toBeInTheDocument();
  });

  it('shows "ต้องอนุมัติ" badge when Maker-Checker enabled and status=DRAFT', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.getByText('ต้องอนุมัติ')).toBeInTheDocument();
  });

  it('does NOT show "ต้องอนุมัติ" badge when status=POSTED even if Maker-Checker on', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" makerCheckerEnabled={true} />);
    expect(screen.queryByText('ต้องอนุมัติ')).not.toBeInTheDocument();
  });

  it('shows "ต้องอนุมัติ" badge when status=READY and Maker-Checker enabled', () => {
    render(<InternalControlBar {...baseProps} status="READY" makerCheckerEnabled={true} />);
    expect(screen.getByText('ต้องอนุมัติ')).toBeInTheDocument();
  });

  it('DRAFT + maker-checker OFF: shows ยกเลิก / บันทึกร่าง / บันทึก & POST', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    expect(screen.getByRole('button', { name: /ยกเลิก/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึกร่าง/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึก & POST/ })).toBeInTheDocument();
  });

  it('DRAFT + maker-checker ON: replaces POST with "ส่งให้อนุมัติ"', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.queryByRole('button', { name: /บันทึก & POST/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ส่งให้อนุมัติ/ })).toBeInTheDocument();
  });

  it('POSTED: shows ปิด + กลับรายการ', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    expect(screen.getByRole('button', { name: /ปิด/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กลับรายการ/ })).toBeInTheDocument();
  });

  it('REVERSED: shows only ปิด', () => {
    render(<InternalControlBar {...baseProps} status="REVERSED" />);
    expect(screen.getByRole('button', { name: /ปิด/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กลับรายการ/ })).not.toBeInTheDocument();
  });

  it('READY + viewer is approver: shows ปฏิเสธ + อนุมัติ & POST', () => {
    render(
      <InternalControlBar
        {...baseProps}
        status="READY"
        makerCheckerEnabled={true}
        isViewerApprover={true}
      />,
    );
    expect(screen.getByRole('button', { name: /ปฏิเสธ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /อนุมัติ & POST/ })).toBeInTheDocument();
  });

  it('READY + viewer is NOT approver: shows only กลับ + รออนุมัติ banner', () => {
    render(
      <InternalControlBar
        {...baseProps}
        status="READY"
        makerCheckerEnabled={true}
        isViewerApprover={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /อนุมัติ/ })).not.toBeInTheDocument();
    expect(screen.getByText(/รออนุมัติ/)).toBeInTheDocument();
  });

  it('fires onPost when "บันทึก & POST" clicked', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" />);
    fireEvent.click(screen.getByRole('button', { name: /บันทึก & POST/ }));
    expect(handlers.onPost).toHaveBeenCalledTimes(1);
  });

  it('fires onReverse when "กลับรายการ" clicked', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    fireEvent.click(screen.getByRole('button', { name: /กลับรายการ/ }));
    expect(handlers.onReverse).toHaveBeenCalledTimes(1);
  });

  it('state machine bar shows 4 dots when maker-checker enabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={true} />);
    expect(screen.getAllByTestId('state-machine-dot')).toHaveLength(4);
  });

  it('state machine bar shows 3 dots when maker-checker disabled', () => {
    render(<InternalControlBar {...baseProps} status="DRAFT" makerCheckerEnabled={false} />);
    expect(screen.getAllByTestId('state-machine-dot')).toHaveLength(3);
  });

  it('active dot has data-state="active"', () => {
    render(<InternalControlBar {...baseProps} status="POSTED" />);
    const dots = screen.getAllByTestId('state-machine-dot');
    const active = dots.find((d) => d.getAttribute('data-state') === 'active');
    expect(active).toHaveAttribute('data-label', 'POSTED');
  });

  it('REVERSED status + MC-off has active dot on REVERSED in 3-step bar', () => {
    render(<InternalControlBar {...baseProps} status="REVERSED" makerCheckerEnabled={false} />);
    const dots = screen.getAllByTestId('state-machine-dot');
    expect(dots).toHaveLength(3);
    const active = dots.find((d) => d.getAttribute('data-state') === 'active');
    expect(active).toHaveAttribute('data-label', 'REVERSED');
  });

  it('DRAFT status without onSaveDraft/onPost handlers: no dead action buttons render', () => {
    // ViewPage uses bar in view-only mode — should not show DRAFT action buttons
    // (PageHeader provides them). Regression guard for dead-button bug.
    render(
      <InternalControlBar
        status="DRAFT"
        recorder={baseProps.recorder}
        approver={baseProps.approver}
        makerCheckerEnabled={false}
        onCancel={handlers.onCancel}
      />,
    );
    expect(screen.queryByRole('button', { name: /บันทึกร่าง/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึก & POST/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ส่งให้อนุมัติ/ })).not.toBeInTheDocument();
    // Cancel button should show "ปิด" not "ยกเลิก" in view-only mode (R3 W2)
    expect(screen.getByRole('button', { name: /ปิด/ })).toBeInTheDocument();
  });

  it('pills hidden when name is empty/dash', () => {
    render(
      <InternalControlBar
        {...baseProps}
        status="POSTED"
        recorder={{ name: '—' }}
        approver={{ name: '' }}
      />,
    );
    expect(screen.queryByText(/ผู้บันทึก:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ผู้อนุมัติ:/)).not.toBeInTheDocument();
  });

  it('READY + viewer is creator (isOwnDoc): suppresses "รออนุมัติจาก OWNER" hint', () => {
    // OWNER creator viewing their own READY doc — PageHeader already shows
    // "ไม่สามารถอนุมัติเอกสารที่ตนสร้างได้", so the bar must not contradict.
    render(
      <InternalControlBar
        {...baseProps}
        status="READY"
        makerCheckerEnabled={true}
        isViewerApprover={false}
        isOwnDoc={true}
      />,
    );
    expect(screen.queryByText(/รออนุมัติจาก OWNER/)).not.toBeInTheDocument();
  });
});
