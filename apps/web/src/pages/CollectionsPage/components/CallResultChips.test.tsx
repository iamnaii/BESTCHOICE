import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CallResultChips from './CallResultChips';

describe('CallResultChips', () => {
  it('renders both rows of chips with Thai labels', () => {
    render(
      <CallResultChips
        callResult={null}
        negotiationResult={null}
        onCallResultChange={() => {}}
        onNegotiationResultChange={() => {}}
      />,
    );
    expect(screen.getByText('ผลการโทร')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'รับสาย' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ไม่รับสาย' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ขอผ่อน' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'จะจ่าย' })).toBeTruthy();
  });

  it('disables negotiation chips when call result is no-contact (NO_ANSWER)', () => {
    render(
      <CallResultChips
        callResult="NO_ANSWER"
        negotiationResult={null}
        onCallResultChange={() => {}}
        onNegotiationResultChange={() => {}}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'จะจ่าย' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('enables negotiation chips when call result is ANSWERED', () => {
    render(
      <CallResultChips
        callResult="ANSWERED"
        negotiationResult={null}
        onCallResultChange={() => {}}
        onNegotiationResultChange={() => {}}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'จะจ่าย' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('clicking a selected chip toggles it off (passes null)', async () => {
    const onCallResultChange = vi.fn();
    render(
      <CallResultChips
        callResult="ANSWERED"
        negotiationResult={null}
        onCallResultChange={onCallResultChange}
        onNegotiationResultChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'รับสาย' }));
    expect(onCallResultChange).toHaveBeenCalledWith(null);
  });

  it('clicking an unselected chip selects it', async () => {
    const onCallResultChange = vi.fn();
    render(
      <CallResultChips
        callResult={null}
        negotiationResult={null}
        onCallResultChange={onCallResultChange}
        onNegotiationResultChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ปิดเครื่อง' }));
    expect(onCallResultChange).toHaveBeenCalledWith('DEVICE_OFF');
  });

  it('aria-pressed reflects selection state', () => {
    render(
      <CallResultChips
        callResult="BUSY"
        negotiationResult={null}
        onCallResultChange={() => {}}
        onNegotiationResultChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'สายไม่ว่าง' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'รับสาย' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
