import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function Harness({
  actions,
  overlay,
}: {
  actions: { onOpenPalette: () => void; onResolve: () => void; onEscape: () => void };
  overlay: boolean;
}) {
  useKeyboardShortcuts(actions);
  return (
    <div role={overlay ? 'dialog' : undefined}>
      <button>ตัวกรอง</button>
    </div>
  );
}

describe('Room shortcuts respect overlays', () => {
  it('does not open templates, resolve a room, or close its palette through another dialog', () => {
    const actions = { onOpenPalette: vi.fn(), onResolve: vi.fn(), onEscape: vi.fn() };
    render(<Harness actions={actions} overlay />);
    const button = screen.getByRole('button', { name: 'ตัวกรอง' });
    fireEvent.keyDown(button, { key: 'R', metaKey: true, shiftKey: true });
    fireEvent.keyDown(button, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(button, { key: 'Escape' });
    Object.values(actions).forEach((action) => expect(action).not.toHaveBeenCalled());
  });

  it('preserves the same shortcuts on the room surface', () => {
    const actions = { onOpenPalette: vi.fn(), onResolve: vi.fn(), onEscape: vi.fn() };
    render(<Harness actions={actions} overlay={false} />);
    const button = screen.getByRole('button', { name: 'ตัวกรอง' });
    fireEvent.keyDown(button, { key: 'R', metaKey: true, shiftKey: true });
    fireEvent.keyDown(button, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(button, { key: 'Escape' });
    Object.values(actions).forEach((action) => expect(action).toHaveBeenCalledTimes(1));
  });
});
