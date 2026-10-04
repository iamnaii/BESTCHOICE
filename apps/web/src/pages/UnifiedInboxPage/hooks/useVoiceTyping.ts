import { useLayoutEffect, useRef, useState } from 'react';

// Web Speech is not in lib.dom and some browsers still expose the prefixed API.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Constructor = new () => Recognition;
function recognitionConstructor() {
  const browser = window as Window & { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
export const VOICE_FALLBACK = 'เบราว์เซอร์นี้ยังใช้ปุ่มไมค์ไม่ได้ ลองใช้ไมค์บนแป้นพิมพ์ของเครื่อง หรือพิมพ์ข้อความได้ตามปกติ';
const errorMessage = (code: string) => {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed':
      return 'เปิดไมค์ไม่ได้ กรุณาอนุญาตไมโครโฟนในการตั้งค่าเบราว์เซอร์ หรือใช้ไมค์บนแป้นพิมพ์';
    case 'audio-capture': return 'ไม่พบไมโครโฟนที่ใช้งานได้ กรุณาตรวจการเชื่อมต่อและสิทธิ์ไมโครโฟน';
    case 'no-speech': return 'ยังไม่ได้ยินเสียง ลองกดไมค์แล้วพูดอีกครั้ง';
    case 'network': return 'บริการแปลงเสียงเชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือใช้ไมค์บนแป้นพิมพ์';
    case 'language-not-supported': return 'บริการนี้ยังไม่รองรับภาษาไทย ลองใช้ไมค์บนแป้นพิมพ์ของเครื่อง';
    default: return 'แปลงเสียงไม่สำเร็จ ลองใหม่ หรือใช้ไมค์บนแป้นพิมพ์ของเครื่อง';
  }
};

export function useVoiceTyping({ roomId, enabled, onText }: {
  roomId: string | undefined;
  enabled: boolean;
  onText: (text: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'listening' | 'stopping'>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const current = useRef<Recognition | null>(null);
  const stopRequested = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callback = useRef(onText);
  useLayoutEffect(() => { callback.current = onText; });
  const supported = !!recognitionConstructor() && window.isSecureContext !== false;

  function finish(abort: boolean) {
    const recognition = current.current;
    current.current = null; // Reject queued callbacks even if abort synchronously emits.
    clearTimeout(timer.current);
    if (recognition) {
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
      if (abort) { try { recognition.abort(); } catch { /* Already ended. */ } }
    }
    setPhase('idle');
    setInterim('');
  }

  // Layout cleanup ends the old session before the next room/mode can accept text.
  useLayoutEffect(() => {
    setError('');
    const hide = () => { if (document.hidden) finish(true); };
    const leave = () => finish(true);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      finish(true);
    };
  }, [roomId, enabled]);

  function stop() {
    const recognition = current.current;
    if (!recognition) return;
    stopRequested.current = true;
    setPhase('stopping');
    clearTimeout(timer.current);
    // stop() may deliver one last final result; keep send blocked until end.
    timer.current = setTimeout(() => {
      finish(true);
      setError('รับเสียงสิ้นสุดแล้ว ข้อความที่ยังแปลงไม่เสร็จอาจขาดหาย กรุณาตรวจข้อความก่อนส่ง');
    }, 5_000);
    try { recognition.stop(); } catch { finish(true); setError(errorMessage('aborted')); }
  }

  function start() {
    if (!enabled || !roomId || current.current) return;
    if (!supported) { setError(VOICE_FALLBACK); return; }
    setError('');
    setInterim('');
    const Constructor = recognitionConstructor()!;
    try {
      const recognition = new Constructor();
      current.current = recognition;
      stopRequested.current = false;
      recognition.lang = 'th-TH';
      recognition.continuous = true;
      recognition.interimResults = true;
      const committed = new Set<number>();
      let receivedText = false;
      const isCurrent = () => current.current === recognition;
      recognition.onstart = () => {
        if (!isCurrent() || stopRequested.current) return;
        clearTimeout(timer.current);
        setPhase('listening');
        timer.current = setTimeout(stop, 180_000);
      };
      recognition.onresult = (event) => {
        if (!isCurrent()) return;
        const pending: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript.trim();
          if (result.isFinal) {
            if (!committed.has(i)) {
              committed.add(i);
              if (text) { receivedText = true; callback.current(text); }
            }
          } else if (text) pending.push(text);
        }
        setInterim(pending.join(' '));
      };
      recognition.onerror = ({ error: code }) => {
        if (!isCurrent()) return;
        finish(true);
        setError(errorMessage(code));
      };
      recognition.onend = () => {
        if (!isCurrent()) return;
        finish(false);
        if (!receivedText) setError(errorMessage('no-speech'));
      };
      setPhase('starting');
      timer.current = setTimeout(() => {
        finish(true);
        setError('เปิดไมค์ไม่สำเร็จ ตรวจสิทธิ์ไมโครโฟนและอินเทอร์เน็ต แล้วลองใหม่');
      }, 15_000);
      recognition.start();
    } catch {
      finish(true);
      setError(errorMessage('not-allowed'));
    }
  }

  return { supported, active: phase !== 'idle', phase, interim, error, start, stop };
}
