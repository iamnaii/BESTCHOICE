import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignaturePadFull from './SignaturePadFull';

describe('SignaturePadFull signing evidence', () => {
  beforeEach(() => {
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ink');
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 320, width: 800, height: 320, toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not accept a blank hover, click or motionless press as a signature', () => {
    const draft = vi.fn();
    const sign = vi.fn();
    const { container } = render(<SignaturePadFull onSign={sign} onDraftChange={draft} />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseLeave(canvas);
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);
    expect(screen.getByRole('button', { name: 'ยืนยันลงนาม' })).toBeDisabled();
    expect(draft).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(['mouse', 'touch'])('publishes drawn %s ink once and clears it explicitly', (input) => {
    const draft = vi.fn();
    const { container } = render(<SignaturePadFull onSign={vi.fn()} onDraftChange={draft} />);
    const canvas = container.querySelector('canvas')!;
    if (input === 'mouse') {
      fireEvent.mouseDown(canvas, { clientX: 20, clientY: 20 });
      fireEvent.mouseMove(canvas, { clientX: 90, clientY: 40 });
      fireEvent.mouseUp(canvas);
    } else {
      fireEvent.touchStart(canvas, { touches: [{ clientX: 20, clientY: 20 }] });
      fireEvent.touchMove(canvas, { touches: [{ clientX: 90, clientY: 40 }] });
      fireEvent.touchEnd(canvas);
    }
    fireEvent.mouseLeave(canvas);
    expect(draft).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,ink');
    expect(screen.getByRole('button', { name: 'ยืนยันลงนาม' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างลายเซ็น' }));
    expect(draft).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'ยืนยันลงนาม' })).toBeDisabled();
  });
});
