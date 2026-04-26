import { useEffect, useState } from 'react';
import { useMySession } from '../hooks/useMySession';
import { useSessionActions } from '../hooks/useSessionActions';
import PreStartScreen from './PreStartScreen';
import FocusMode from './FocusMode';
import SessionSummary from './SessionSummary';
import PoolBrowser from './PoolBrowser';

const TARGET_MINUTES = 150;
const STORAGE_KEY = 'collections.session.startedAt';
const STORAGE_KEY_PAUSED = 'collections.session.pausedMs';
const STORAGE_KEY_PAUSED_AT = 'collections.session.pausedAt';

type Phase = 'PRE' | 'FOCUS' | 'PAUSE' | 'SUMMARY' | 'POOL';

export default function SessionView() {
  const { data, isLoading } = useMySession();
  const { start } = useSessionActions();
  const [phase, setPhase] = useState<Phase>('PRE');
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [pausedMs, setPausedMs] = useState<number>(0);
  const [pausedAt, setPausedAt] = useState<Date | null>(null);

  // Restore session start (and pause state) from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const d = new Date(stored);
      if (!isNaN(d.getTime())) {
        setStartedAt(d);
        const storedPaused = localStorage.getItem(STORAGE_KEY_PAUSED);
        const storedPausedAt = localStorage.getItem(STORAGE_KEY_PAUSED_AT);
        const pmsRaw = storedPaused ? Number(storedPaused) : 0;
        setPausedMs(Number.isFinite(pmsRaw) ? pmsRaw : 0);
        if (storedPausedAt) {
          const p = new Date(storedPausedAt);
          if (!isNaN(p.getTime())) {
            setPausedAt(p);
            setPhase('PAUSE');
            return;
          }
        }
        setPhase('FOCUS');
      }
    }
  }, []);

  // Auto-detect summary state from server: when there's a summary AND no
  // pending contracts, the day is done — show summary unless user is
  // browsing the pool.
  useEffect(() => {
    if (data?.summary && data.contracts.length === 0 && phase !== 'POOL' && phase !== 'PRE') {
      setPhase('SUMMARY');
    }
  }, [data, phase]);

  const handleStart = () => {
    start.mutate(undefined, {
      onSuccess: () => {
        const now = new Date();
        localStorage.setItem(STORAGE_KEY, now.toISOString());
        localStorage.removeItem(STORAGE_KEY_PAUSED);
        localStorage.removeItem(STORAGE_KEY_PAUSED_AT);
        setStartedAt(now);
        setPausedMs(0);
        setPausedAt(null);
        setPhase('FOCUS');
      },
    });
  };

  const handlePause = () => {
    const now = new Date();
    setPausedAt(now);
    localStorage.setItem(STORAGE_KEY_PAUSED_AT, now.toISOString());
    setPhase('PAUSE');
  };
  const handleResume = () => {
    if (pausedAt) {
      const elapsedPause = Date.now() - pausedAt.getTime();
      const newPausedMs = pausedMs + elapsedPause;
      setPausedMs(newPausedMs);
      setPausedAt(null);
      localStorage.setItem(STORAGE_KEY_PAUSED, String(newPausedMs));
      localStorage.removeItem(STORAGE_KEY_PAUSED_AT);
    }
    setPhase('FOCUS');
  };
  const handleBackToHome = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_PAUSED);
    localStorage.removeItem(STORAGE_KEY_PAUSED_AT);
    setStartedAt(null);
    setPausedMs(0);
    setPausedAt(null);
    setPhase('PRE');
  };

  if (phase === 'POOL') {
    return <PoolBrowser onClose={() => setPhase(data?.summary ? 'SUMMARY' : 'PRE')} />;
  }

  if (phase === 'SUMMARY' && data?.summary) {
    return (
      <SessionSummary
        summary={data.summary}
        targetMinutes={TARGET_MINUTES}
        onShowPool={() => setPhase('POOL')}
        onBackToHome={handleBackToHome}
      />
    );
  }

  if ((phase === 'FOCUS' || phase === 'PAUSE') && data && startedAt) {
    if (phase === 'PAUSE') {
      return (
        <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6 text-center max-w-3xl mx-auto">
          <div className="text-base font-semibold leading-snug mb-1">หยุดพักอยู่</div>
          <div className="text-sm text-muted-foreground leading-snug mb-4">
            กดปุ่มด้านล่างเพื่อทำงานต่อ
          </div>
          <button
            type="button"
            onClick={handleResume}
            className="rounded-lg bg-primary text-primary-foreground px-6 py-2.5 text-base font-medium hover:opacity-90 transition-opacity"
          >
            เริ่มต่อ
          </button>
        </div>
      );
    }
    return <FocusMode session={data} startedAt={startedAt} pausedMs={pausedMs} onPause={handlePause} />;
  }

  return (
    <PreStartScreen
      data={data}
      isLoading={isLoading}
      onStart={handleStart}
      starting={start.isPending}
    />
  );
}
