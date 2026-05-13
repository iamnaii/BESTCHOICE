import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OverrideConfirmDialog } from '../OverrideConfirmDialog';

describe('OverrideConfirmDialog', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it('does not render when open=false', () => {
    render(<OverrideConfirmDialog open={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByText(/แก้ไข Auto Journal ด้วยตนเอง/)).not.toBeInTheDocument();
  });

  it('renders warning + impacts + checkbox when open', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText(/แก้ไข Auto Journal ด้วยตนเอง/)).toBeInTheDocument();
    expect(screen.getByText(/ตรวจสอบ V1\/V2\/V5/)).toBeInTheDocument();
    expect(screen.getByText(/บันทึกใน Audit Log/)).toBeInTheDocument();
    expect(screen.getByText(/ฉันเข้าใจและรับผิดชอบ/)).toBeInTheDocument();
  });

  it('confirm button is disabled until acknowledgement checkbox is checked', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    const confirmBtn = screen.getByRole('button', { name: /เปิดโหมดแก้ไข/ });
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm when confirm clicked after acknowledging', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /เปิดโหมดแก้ไข/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel clicked', () => {
    render(<OverrideConfirmDialog open={true} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
