import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, LogIn, LogOut, WifiOff } from 'lucide-react';
import { KioskApiError, kioskApi, type PunchResult } from '@/lib/kiosk-api';
import { clearDevice, loadDevice, saveDevice, type KioskDevice } from '@/lib/kiosk-store';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PinPad from './PinPad';
import CameraPreview, { type CameraHandle, type CameraState } from './CameraPreview';
import RegisterScreen from './RegisterScreen';
import ResultScreen from './ResultScreen';
import DeviceBlockedScreen from './DeviceBlockedScreen';
import { formatClock, formatThaiDate, useServerClock } from './useServerClock';

/**
 * หน้าตอกบัตรบนเครื่องประจำสาขา (ก้อน 10 D3 · สเปก §4.2 · mockup บอร์ด 1–2) — เส้นทางสาธารณะ `/kiosk` ไม่มี session
 * - เปิดได้เฉพาะเครื่องที่ลงทะเบียน (token ใน store) · heartbeat ทุก 10 นาที · เวลาแสดงจากเซิร์ฟเวอร์
 * - ไม่มีเน็ต/เซิร์ฟเวอร์ไม่ตอบ = แดง "ยังไม่ได้บันทึก" ห้ามโชว์สำเร็จหลอก · รหัสผิดไม่บอกชื่อใคร
 * - PWA ของเครื่องนี้ใช้ manifest แยก (/kiosk/manifest.webmanifest) — สลับ <link rel=manifest> ตอน mount
 */
type Phase = 'register' | 'ready' | 'submitting' | 'result' | 'blocked';
type Kind = 'IN' | 'OUT';

const HEARTBEAT_MS = 10 * 60_000;
const RESULT_MS = 5_000;
const KIOSK_MANIFEST = '/kiosk/manifest.webmanifest';
const BIG = 'flex h-[88px] items-center justify-center gap-3 rounded-2xl border-2 text-2xl font-bold transition-colors';

export default function KioskPage() {
  useDocumentTitle('เครื่องตอกบัตร');
  const [device, setDevice] = useState<KioskDevice | null>(() => loadDevice());
  const [phase, setPhase] = useState<Phase>(() => (loadDevice() ? 'ready' : 'register'));
  const [kind, setKind] = useState<Kind | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [result, setResult] = useState<{ data: PunchResult; noPhoto: boolean } | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [offline, setOffline] = useState(false);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [lastPunch, setLastPunch] = useState<string | null>(null);
  const cameraRef = useRef<CameraHandle>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useServerClock(offsetMs);

  const syncClock = (serverTime: string) => {
    const t = Date.parse(serverTime);
    if (!Number.isNaN(t)) setOffsetMs(t - Date.now());
  };

  const handleDeviceError = useCallback((err: unknown): boolean => {
    if (!(err instanceof KioskApiError)) return false;
    if (err.code === 'DEVICE_REVOKED') {
      clearDevice();
      setDevice(null);
      setPhase('register');
      setRegisterError('เครื่องนี้ถูกยกเลิกแล้ว — ลงทะเบียนใหม่ด้วยรหัสใหม่จากเจ้าของ');
      return true;
    }
    if (err.code === 'DEVICE_LOCKED') {
      setBlockedMessage(err.message || 'ระบบพบว่ารหัสเครื่องนี้ถูกใช้จากสองที่ จึงหยุดรับการตอกบัตรทั้งหมด');
      setPhase('blocked');
      return true;
    }
    return false;
  }, []);

  const heartbeat = useCallback(async () => {
    const current = loadDevice();
    if (!current) return;
    try {
      const out = await kioskApi.heartbeat(current.token);
      syncClock(out.serverTime);
      setOffline(false);
      if (out.device?.status && out.device.status !== 'ACTIVE') {
        setBlockedMessage('เครื่องนี้ถูกล็อกหรือยกเลิกแล้ว');
        setPhase('blocked');
        return;
      }
      setDevice((d) => (d ? { ...d, branchName: out.device.branchName || d.branchName, deviceName: out.device.name || d.deviceName, token: loadDevice()?.token ?? d.token } : d));
      setPhase((p) => (p === 'blocked' ? 'ready' : p));
    } catch (err) {
      if (handleDeviceError(err)) return;
      if (err instanceof KioskApiError && err.network) setOffline(true);
    }
  }, [handleDeviceError]);

  // heartbeat ตอน mount + ทุก 10 นาที (ทำให้ token หมุนสม่ำเสมอแม้ไม่มีใครตอก) · สลับ manifest ของ PWA
  useEffect(() => {
    const link = typeof document !== 'undefined' ? document.querySelector<HTMLLinkElement>('link[rel="manifest"]') : null;
    const original = link?.getAttribute('href') ?? null;
    link?.setAttribute('href', KIOSK_MANIFEST);
    if (device) void heartbeat();
    const id = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      if (link && original) link.setAttribute('href', original);
      if (resultTimer.current) clearTimeout(resultTimer.current);
    };
    // mount ครั้งเดียว — device ที่เปลี่ยนภายหลังถูกอ่านจาก store ใน heartbeat เอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetToReady = useCallback(() => {
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = null;
    setResult(null);
    setKind(null);
    setPin('');
    setError(null);
    setPhase('ready');
  }, []);

  const register = async (code: string, deviceName: string) => {
    setRegisterError(null);
    setPhase('submitting');
    try {
      const out = await kioskApi.register(code, deviceName);
      const next: KioskDevice = { token: out.deviceToken, branchName: out.branch.name, deviceName: out.device.name };
      saveDevice(next);
      setDevice(next);
      syncClock(out.serverTime);
      setPhase('ready');
    } catch (err) {
      setRegisterError(err instanceof KioskApiError ? err.message : 'ลงทะเบียนไม่สำเร็จ');
      setPhase('register');
    }
  };

  const submit = async () => {
    const current = loadDevice();
    if (!current || !kind || pin.length !== 6) return;
    setError(null);
    setPhase('submitting');
    const photo = (await cameraRef.current?.capture()) ?? null;
    try {
      const out = await kioskApi.punch({ token: current.token, pin, kind, photo: photo ?? undefined });
      syncClock(out.serverTime);
      setOffline(false);
      const noPhoto = !photo || out.result.flags.includes('NO_PHOTO');
      setResult({ data: out.result, noPhoto });
      setLastPunch(`${out.result.nickname} ${out.result.kind === 'IN' ? 'เข้างาน' : 'ออกงาน'} ${formatClock(new Date(out.result.at))}`);
      setPhase('result');
      resultTimer.current = setTimeout(resetToReady, RESULT_MS);
    } catch (err) {
      if (handleDeviceError(err)) return;
      if (err instanceof KioskApiError && err.network) {
        setOffline(true);
        setError({ message: 'ยังไม่ได้บันทึก — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจเน็ตของแท็บเล็ตแล้วกดลองใหม่', retryable: true });
        setPhase('ready');
        return;
      }
      const message = err instanceof KioskApiError ? err.message : 'ยังไม่ได้บันทึก — ลองใหม่';
      setError({ message, retryable: false });
      setPin('');
      setPhase('ready');
    }
  };

  if (phase === 'register' || !device) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <RegisterScreen onRegister={register} error={registerError} busy={phase === 'submitting'} />
      </main>
    );
  }

  if (phase === 'blocked') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <DeviceBlockedScreen message={blockedMessage} onRetry={() => void heartbeat()} />
      </main>
    );
  }

  const canSubmit = phase === 'ready' && !!kind && pin.length === 6;
  const confirmLabel = kind === 'IN' ? 'ยืนยันเข้างาน · ถ่ายรูป' : kind === 'OUT' ? 'ยืนยันออกงาน · ถ่ายรูป' : 'ยืนยัน';

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-background p-6 lg:p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Building2 className="size-5" aria-hidden="true" /></div>
          <div>
            <div className="text-xl font-bold leading-snug">{device.branchName}</div>
            <div className="text-sm text-muted-foreground leading-snug">
              {device.deviceName} · {offline ? <span className="inline-flex items-center gap-1 text-destructive"><WifiOff className="size-3.5" aria-hidden="true" />ออฟไลน์</span> : <span className="text-primary">ออนไลน์</span>} · เวลาจากเซิร์ฟเวอร์
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-bold leading-none tabular-nums tracking-tight">{formatClock(now)}</div>
          <div className="mt-1 text-sm text-muted-foreground">{formatThaiDate(now)}</div>
        </div>
      </header>

      {phase === 'result' && result ? (
        <ResultScreen result={result.data} noPhoto={result.noPhoto} onDone={resetToReady} />
      ) : (
        <section className="grid flex-1 gap-6 lg:grid-cols-2">
          <div className="flex min-h-[260px] flex-col gap-3">
            <CameraPreview ref={cameraRef} onState={setCamera} />
            <p className="text-sm text-muted-foreground leading-snug">
              รูปใช้เป็นหลักฐานการลงเวลา เจ้าของและผู้จัดการสาขาดูได้ · เก็บตามอายุที่เจ้าของตั้ง
              {camera === 'denied' && <span className="ml-1 text-warning-strong">กล้องใช้ไม่ได้ — จะบันทึกโดยไม่มีรูป</span>}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" aria-pressed={kind === 'IN'} onClick={() => { setKind('IN'); setError(null); }} disabled={phase === 'submitting'} className={`${BIG} ${kind === 'IN' ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-foreground'}`}>
                <LogIn className="size-7" aria-hidden="true" />เข้างาน
              </button>
              <button type="button" aria-pressed={kind === 'OUT'} onClick={() => { setKind('OUT'); setError(null); }} disabled={phase === 'submitting'} className={`${BIG} ${kind === 'OUT' ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-foreground'}`}>
                <LogOut className="size-7" aria-hidden="true" />ออกงาน
              </button>
            </div>

            <div className="text-center text-base font-medium">รหัสตอกบัตร 6 หลัก</div>
            <PinPad value={pin} onChange={(v) => { setPin(v); if (error && !error.retryable) setError(null); }} disabled={phase === 'submitting'} />

            {error && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive leading-snug">
                <span>{error.message}</span>
                {error.retryable && (
                  <button type="button" onClick={() => void submit()} className="h-11 flex-none rounded-lg bg-foreground px-4 font-medium text-background">ลองใหม่</button>
                )}
              </div>
            )}

            <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="h-[72px] rounded-2xl bg-foreground text-xl font-bold text-background disabled:opacity-40" aria-busy={phase === 'submitting'}>
              {phase === 'submitting' ? 'กำลังบันทึก…' : confirmLabel}
            </button>
          </div>
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>รหัสเป็นของคุณคนเดียว ห้ามบอกเพื่อน · ตอกแทนกันเห็นจากรูปถ่าย</span>
        {lastPunch && <span>ตอกครั้งล่าสุดบนเครื่องนี้: {lastPunch}</span>}
      </footer>
    </main>
  );
}
