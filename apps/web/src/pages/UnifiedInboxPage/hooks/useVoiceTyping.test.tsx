import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceTyping } from './useVoiceTyping';

class Recognition {
  static instances: Recognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
}
const last = () => Recognition.instances.at(-1)!;
const results = (text: string, isFinal = true) => ({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });

beforeEach(() => {
  vi.useFakeTimers();
  Recognition.instances = [];
  vi.stubGlobal('SpeechRecognition', Recognition);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  const onText = vi.fn();
  const hook = renderHook(({ roomId, enabled }) => useVoiceTyping({ roomId, enabled, onText }), {
    initialProps: { roomId: 'a', enabled: true },
  });
  return { ...hook, onText };
}

describe('customer chat voice typing', () => {
  it('starts only on demand in Thai, shows interim separately and appends each final once', () => {
    const { result, onText } = setup();
    expect(Recognition.instances).toHaveLength(0);
    act(() => result.current.start());
    expect(last().lang).toBe('th-TH');
    expect(result.current.active).toBe(true);
    act(() => last().onstart?.());
    act(() => last().onresult?.(results('สวัสดี', false)));
    expect(result.current.interim).toBe('สวัสดี');
    expect(onText).not.toHaveBeenCalled();
    act(() => last().onresult?.(results('สวัสดีครับ')));
    act(() => last().onresult?.(results('สวัสดีครับ')));
    expect(onText).toHaveBeenCalledExactlyOnceWith('สวัสดีครับ');
    expect(result.current.interim).toBe('');
  });

  it('waits for final text on stop and ignores late callbacks after end', () => {
    const { result, onText } = setup();
    act(() => result.current.start());
    const receive = last().onresult!;
    act(() => result.current.stop());
    expect(last().stop).toHaveBeenCalledOnce();
    expect(result.current.active).toBe(true);
    act(() => receive(results('ขอบคุณครับ')));
    act(() => last().onend?.());
    expect(result.current.active).toBe(false);
    act(() => receive(results('ข้อความเก่า')));
    expect(onText).toHaveBeenCalledExactlyOnceWith('ขอบคุณครับ');
  });

  it.each(['room', 'disabled'] as const)('aborts and rejects stale text on %s change', (change) => {
    const { result, rerender, onText } = setup();
    act(() => result.current.start());
    const old = last();
    const receive = old.onresult!;
    rerender({ roomId: change === 'room' ? 'b' : 'a', enabled: change !== 'disabled' });
    expect(old.abort).toHaveBeenCalledOnce();
    act(() => receive(results('ของห้องเดิม')));
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('aborts on unmount and when page becomes hidden', () => {
    const { result, unmount } = setup();
    act(() => result.current.start());
    act(() => {
      vi.spyOn(document, 'hidden', 'get').mockReturnValueOnce(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(last().abort).toHaveBeenCalledOnce();
    act(() => result.current.start());
    unmount();
    expect(last().abort).toHaveBeenCalledOnce();
  });

  it('explains denied permission and permits retry', () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => last().onerror?.({ error: 'not-allowed' }));
    expect(result.current.active).toBe(false);
    expect(result.current.error).toContain('อนุญาต');
    act(() => result.current.start());
    expect(result.current.error).toBe('');
    expect(Recognition.instances).toHaveLength(2);
  });

  it('keeps the stop watchdog if startup completes after the user pressed stop', () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => result.current.stop());
    act(() => last().onstart?.());
    expect(result.current.phase).toBe('stopping');
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.active).toBe(false);
    expect(last().abort).toHaveBeenCalledOnce();
  });

  it('recovers from a stalled start or stop without leaving the composer blocked', () => {
    const { result } = setup();
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.active).toBe(false);
    expect(last().abort).toHaveBeenCalledOnce();
    act(() => result.current.start());
    act(() => last().onstart?.());
    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.active).toBe(false);
    expect(last().abort).toHaveBeenCalledOnce();
  });

  it('supports prefixed browsers and gives a fallback on unsupported browsers', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', Recognition);
    const prefixed = setup();
    expect(prefixed.result.current.supported).toBe(true);
    prefixed.unmount();
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const unsupported = setup();
    expect(unsupported.result.current.supported).toBe(false);
    act(() => unsupported.result.current.start());
    expect(Recognition.instances).toHaveLength(0);
    expect(unsupported.result.current.error).toContain('แป้นพิมพ์');
  });
});
