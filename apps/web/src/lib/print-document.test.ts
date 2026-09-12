import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { printDocument } from './print-document';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});

describe('printDocument', () => {
  it('does not open print while the bold font is still loading', async () => {
    let finishBold!: (value: object[]) => void;
    const bold = new Promise<object[]>(resolve => { finishBold = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: {
      load: vi.fn((font: string) => font.startsWith('700') ? bold : Promise.resolve([{}])),
      ready: Promise.resolve(),
    } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const pending = printDocument();
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    finishBold([{}]);
    await pending;
    expect(print).toHaveBeenCalledTimes(1);
  });

  it.each(['empty', 'failed'])('keeps a failed font load out of print preview', async result => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: {
      load: result === 'failed' ? vi.fn().mockRejectedValue(new Error('font request failed')) : vi.fn().mockResolvedValue([]),
      ready: Promise.resolve(),
    } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await printDocument();
    expect(print).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ฟอนต์'));
  });
});
