import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NextBestActionChip from './NextBestActionChip';

describe('NextBestActionChip', () => {
  it('renders nothing on null action', () => {
    const { container } = render(<NextBestActionChip action={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on NOOP action (empty UI when no rule fires)', () => {
    const { container } = render(
      <NextBestActionChip
        action={{ type: 'NOOP', label: 'x', reason: 'y' }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders label + reason title when action present', () => {
    render(
      <NextBestActionChip
        action={{ type: 'CALL', label: 'โทรเลย', reason: 'ลูกค้าสะดวก' }}
      />,
    );
    expect(screen.getByText('โทรเลย')).toBeTruthy();
    expect(screen.getByTestId('next-best-action-chip').getAttribute('title')).toBe(
      'ลูกค้าสะดวก',
    );
  });

  it('clickable when onClick provided — fires with action type', async () => {
    const onClick = vi.fn();
    render(
      <NextBestActionChip
        action={{ type: 'SEND_LINE', label: 'ส่ง LINE', reason: 'online' }}
        onClick={onClick}
      />,
    );
    await userEvent.click(screen.getByTestId('next-best-action-chip'));
    expect(onClick).toHaveBeenCalledWith('SEND_LINE');
  });

  it('renders as a span (read-only) when no onClick', () => {
    render(
      <NextBestActionChip
        action={{ type: 'PROPOSE_LOCK', label: 'เสนอล็อค', reason: 'overdue' }}
      />,
    );
    expect(screen.getByTestId('next-best-action-chip').tagName).toBe('SPAN');
  });

  it('uses bg-info semantic token (not hardcoded blue)', () => {
    render(
      <NextBestActionChip
        action={{ type: 'CALL', label: 'โทร', reason: 'r' }}
      />,
    );
    const chip = screen.getByTestId('next-best-action-chip');
    expect(chip.className).toMatch(/bg-info\/10/);
    expect(chip.className).not.toMatch(/bg-blue-/);
  });
});
