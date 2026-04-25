import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Voice memo recorder hook (P2 Task 4 — Collections C3).
 *
 * Wraps `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`.
 *
 * Behaviour:
 *  - `startRecording()` requests mic permission, then begins capture.
 *    Permission denied throws + shows Thai toast.
 *  - Auto-stops at MAX_DURATION_SEC (60s).
 *  - `stopRecording()` flushes the active recorder and exposes `audioBlob`.
 *  - `clearRecording()` resets state (call before re-recording).
 *
 * Browser support: MediaRecorder is supported in Chrome 49+, Firefox 25+,
 * Safari 14.1+, Edge 79+ — covers 100% of modern desktop/mobile we target.
 * Mime type defaults to `audio/webm;codecs=opus` with safe fallbacks.
 */

const MAX_DURATION_SEC = 60;

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mpeg',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export interface UseMediaRecorderReturn {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearRecording: () => void;
  isRecording: boolean;
  audioBlob: Blob | null;
  duration: number;
  mimeType: string | null;
  error: Error | null;
  isSupported: boolean;
}

export function useMediaRecorder(): UseMediaRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const cleanup = useCallback(() => {
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  // Final cleanup on unmount only (intentional empty deps)
  useEffect(() => () => cleanup(), []);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        // ignore — state guard above prevents most failures
      }
    }
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      const err = new Error('เบราว์เซอร์ไม่รองรับการอัดเสียง');
      setError(err);
      toast.error(err.message);
      throw err;
    }

    setError(null);
    setAudioBlob(null);
    setDuration(0);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      toast.error('ไม่อนุญาตเข้าถึงไมโครโฟน');
      throw e;
    }

    streamRef.current = stream;
    const chosenMime = pickMimeType();
    setMimeType(chosenMime ?? null);

    let recorder: MediaRecorder;
    try {
      recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      toast.error('ไม่สามารถเริ่มการอัดเสียงได้');
      throw e;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const finalMime = chosenMime ?? recorder.mimeType ?? 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: finalMime });
      setAudioBlob(blob);
      setIsRecording(false);
      // Release mic
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    recorderRef.current = recorder;
    recorder.start(250); // collect chunks every 250ms for responsive cancel
    setIsRecording(true);

    const startedAt = Date.now();
    tickIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setDuration(Math.min(elapsed, MAX_DURATION_SEC));
    }, 250);

    autoStopTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, MAX_DURATION_SEC * 1000);
  }, [isSupported, stopRecording]);

  const clearRecording = useCallback(() => {
    cleanup();
    setIsRecording(false);
    setAudioBlob(null);
    setDuration(0);
    setError(null);
  }, [cleanup]);

  return {
    startRecording,
    stopRecording,
    clearRecording,
    isRecording,
    audioBlob,
    duration,
    mimeType,
    error,
    isSupported,
  };
}
