import axios, { type AxiosError } from 'axios';
import { API_URL } from '@/lib/env';
import { loadDevice, setPendingRequest, updateToken } from './kiosk-store';

/**
 * client ของเครื่องตอกบัตร (ก้อน 10 D3 · สเปก §8 · รีวิว C1/C3/I5/I6) — แยกจาก `api` หลัก: ไม่มี cookie ไม่มี refresh/redirect ไป /login
 * - token หมุนเฉพาะเมื่องานสำเร็จ (เซิร์ฟเวอร์) ⇒ error ใด ๆ = token เดิมยังใช้ได้
 * - **ทุกคำขอเข้าคิวเดียว** และอ่าน token จาก store ตอนส่ง (heartbeat ไม่แซงการตอกที่ค้าง — เดิมทำให้เครื่องล็อกตัวเอง)
 * - ทุกคำขอมี requestId (uuid v4) จดเป็น "ค้าง" ก่อนส่ง · เน็ตสะดุด/REQUEST_BUSY ส่งซ้ำ 1 ครั้งด้วย requestId เดิม
 *   ยังไม่ได้คำตอบ = คง pending ไว้ → "ลองใหม่" ส่ง requestId เดิม · คำขอใหม่ครั้งถัดไปเก็บคำตอบที่ค้างก่อน (heartbeat ด้วย requestId นั้น)
 */
export type KioskErrorCode = 'DEVICE_REVOKED' | 'DEVICE_LOCKED' | 'PIN_LOCKED' | 'PIN_INVALID' | 'REQUEST_BUSY' | string;

export class KioskApiError extends Error {
  code?: KioskErrorCode;
  status?: number;
  network: boolean;
  /** requestId ของคำขอที่ล้ม — ใช้ "ลองใหม่" ให้เป็นคำขอเดิม */
  requestId?: string;
  constructor(message: string, opts: { code?: KioskErrorCode; status?: number; network?: boolean } = {}) {
    super(message);
    this.name = 'KioskApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.network = !!opts.network;
  }
  /** ยังไม่รู้ผลแน่นอน — ส่งซ้ำด้วย requestId เดิมได้ */
  get retryable(): boolean {
    return this.network || this.code === 'REQUEST_BUSY';
  }
}

export interface RegisterResponse {
  deviceToken: string;
  branch: { id: string; name: string };
  device: { id: string; name: string };
  serverTime: string;
}
export interface HeartbeatResponse {
  nextDeviceToken?: string;
  serverTime: string;
  device: { status: string; name: string; branchName: string };
}
export interface PunchResult {
  nickname: string;
  kind: 'IN' | 'OUT';
  at: string;
  status: 'ON_TIME' | 'LATE' | 'OUT' | 'OUT_OT';
  lateMinutes: number;
  otHours: number;
  flags: string[];
}
export interface PunchResponse {
  nextDeviceToken?: string;
  serverTime: string;
  result: PunchResult;
}

const client = axios.create({ baseURL: API_URL, timeout: 15000, withCredentials: false, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
const RETRY_DELAY_MS = 1500;

/** uuid v4 · เครื่องเก่า (iOS < 15.4) ไม่มี crypto.randomUUID → สร้างจาก getRandomValues (DTO ฝั่งเซิร์ฟเวอร์รับเฉพาะ v4) */
export function newRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** API ห่อคำตอบสำเร็จเป็น { success, data } — แกะให้ */
const unwrap = <T>(data: unknown): T => {
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) return (data as { data: T }).data;
  return data as T;
};

const pickString = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined);

function toError(err: unknown): KioskApiError {
  const ax = err as AxiosError<Record<string, unknown>>;
  if (ax?.response) {
    const raw = (ax.response.data ?? {}) as Record<string, unknown>;
    const body = (raw.error && typeof raw.error === 'object' ? (raw.error as Record<string, unknown>) : raw) as Record<string, unknown>;
    return new KioskApiError(pickString(body.message) ?? pickString(raw.message) ?? 'เกิดข้อผิดพลาด', { code: pickString(body.code) ?? pickString(raw.code), status: ax.response.status });
  }
  return new KioskApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { network: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(path: string, body: FormData | Record<string, unknown>, retry = true): Promise<T> {
  try {
    const res = await client.post(path, body);
    return unwrap<T>(res.data);
  } catch (err) {
    const e = toError(err);
    if (e.retryable && retry) {
      await sleep(RETRY_DELAY_MS);
      return post<T>(path, body, false); // requestId เดิมอยู่ใน body → ได้คำตอบเดิมถ้าคำขอแรกถึงเซิร์ฟเวอร์แล้ว
    }
    throw e;
  }
}

let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** ส่งคำขอหนึ่งครั้งพร้อมจด/ล้าง pending ตามผลที่ได้ */
async function settle<T>(path: string, body: FormData | Record<string, unknown>, requestId: string): Promise<T> {
  setPendingRequest(requestId);
  try {
    const out = await post<T>(path, body);
    const next = (out as { nextDeviceToken?: unknown } | null)?.nextDeviceToken;
    if (typeof next === 'string' && next) updateToken(next);
    else setPendingRequest(null);
    return out;
  } catch (err) {
    const e = err instanceof KioskApiError ? err : toError(err);
    e.requestId = requestId;
    if (!e.retryable) setPendingRequest(null); // ได้คำตอบแน่นอนแล้ว (token เดิมยังใช้ได้)
    throw e;
  }
}

/** คำขอที่ค้างจากครั้งก่อน: heartbeat ด้วย requestId นั้น = เซิร์ฟเวอร์คืนคำตอบเดิม + token ใหม่ หรือทำ heartbeat ปกติถ้าคำขอนั้นไม่เคยถึง */
async function recoverPending(token: string, pendingRequestId: string): Promise<void> {
  try {
    await settle('/kiosk/heartbeat', { deviceToken: token, requestId: pendingRequestId }, pendingRequestId);
  } catch (err) {
    const e = err as KioskApiError;
    if (e.retryable || e.code === 'DEVICE_REVOKED' || e.code === 'DEVICE_LOCKED') throw e;
  }
}

function deviceCall<T>(path: string, build: (token: string, requestId: string) => FormData | Record<string, unknown>, requestId?: string): Promise<T> {
  return serialize(async () => {
    let device = loadDevice();
    if (!device) throw new KioskApiError('เครื่องนี้ยังไม่ได้ลงทะเบียน', { code: 'DEVICE_REVOKED' });
    if (device.pendingRequestId && device.pendingRequestId !== requestId) {
      await recoverPending(device.token, device.pendingRequestId);
      device = loadDevice() ?? device;
    }
    const rid = requestId ?? newRequestId();
    return settle<T>(path, build(device.token, rid), rid);
  });
}

export const kioskApi = {
  async register(code: string, deviceName: string): Promise<RegisterResponse> {
    return post<RegisterResponse>('/kiosk/register', { code, deviceName });
  },

  heartbeat(): Promise<HeartbeatResponse> {
    return deviceCall<HeartbeatResponse>('/kiosk/heartbeat', (token, requestId) => ({ deviceToken: token, requestId }));
  },

  /** `requestId` = ลองใหม่ของคำขอเดิม (จาก KioskApiError.requestId) · ไม่ส่ง = คำขอใหม่ */
  async punch(input: { pin: string; kind: 'IN' | 'OUT'; photo?: Blob; geo?: { lat: number; lng: number }; requestId?: string }): Promise<PunchResponse> {
    const out = await deviceCall<PunchResponse>(
      '/kiosk/punch',
      (token, requestId) => {
        const form = new FormData();
        form.set('deviceToken', token);
        form.set('requestId', requestId);
        form.set('pin', input.pin);
        form.set('kind', input.kind);
        if (input.geo) {
          form.set('geoLat', input.geo.lat.toFixed(6));
          form.set('geoLng', input.geo.lng.toFixed(6));
        }
        if (input.photo) form.set('photo', input.photo, 'photo.jpg');
        return form;
      },
      input.requestId,
    );
    // ลองใหม่ด้วย requestId ที่ heartbeat กู้ไปแล้ว (การตอกครั้งนั้นไม่ถึงเซิร์ฟเวอร์) ⇒ ได้คำตอบ heartbeat กลับมา ไม่ใช่ผลการตอก
    if (!out?.result) throw new KioskApiError('ยังไม่ได้บันทึก — กดยืนยันอีกครั้ง', { code: 'NOT_RECORDED' });
    return out;
  },
};
