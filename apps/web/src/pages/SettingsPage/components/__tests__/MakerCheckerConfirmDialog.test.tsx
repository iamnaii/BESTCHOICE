import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MakerCheckerConfirmDialog } from '../MakerCheckerConfirmDialog';

describe('MakerCheckerConfirmDialog', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  it('does not render when open=false', () => {
    render(
      <MakerCheckerConfirmDialog
        open={false}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.queryByText(/Maker-Checker/)).not.toBeInTheDocument();
  });

  it('OFF→ON: shows enable impacts + requires ack', () => {
    render(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText(/เปิดระบบ Maker-Checker/)).toBeInTheDocument();
    expect(screen.getByText(/ต้องผ่านผู้อนุมัติ/)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันเปิด/ });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('ON→OFF: shows disable impacts + pending count + requires ack', () => {
    render(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={false}
        pendingReadyCount={3}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText(/ปิดระบบ Maker-Checker/)).toBeInTheDocument();
    expect(screen.getByText(/auto-approve/i)).toBeInTheDocument();
    expect(screen.getByText(/3 ฉบับ/)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /ยืนยันปิด/ });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmBtn).toBeEnabled();
  });

  it('calls onConfirm when confirm clicked', () => {
    render(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันเปิด/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel clicked', () => {
    render(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resets acknowledgement on close', () => {
    const { rerender } = render(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(
      <MakerCheckerConfirmDialog
        open={false}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    rerender(
      <MakerCheckerConfirmDialog
        open={true}
        nextValue={true}
        pendingReadyCount={0}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByRole('button', { name: /ยืนยัน/ })).toBeDisabled();
  });
});
