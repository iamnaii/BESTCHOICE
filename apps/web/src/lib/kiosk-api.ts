import axios, { type AxiosError } from 'axios';
import { API_URL } from '@/lib/env';
import { updateToken } from './kiosk-store';

/**
 * client ของเครื่องตอกบัตร (ก้อน 10 D3 · สเปก §8) — แยกจาก `api` หลัก: ไม่มี cookie ไม่มี refresh/redirect ไป /login
 * - ทุกคำขอมี requestId (uuid) · เน็ตสะดุดส่งซ้ำ 1 ครั้งด้วย requestId เดิม → เซิร์ฟเวอร์คืนคำตอบเดิม ไม่หมุน token ซ้ำ
 * - token รุ่นถัดไปในคำตอบ (รวมคำตอบ error 400/423) ถูกเก็บลง store ทันที
 */
export type KioskErrorCode = 'DEVICE_REVOKED' | 'DEVICE_LOCKED' | 'PIN_LOCKED' | 'PIN_INVALID' | string;

export class KioskApiError extends Error {
  code?: KioskErrorCode;
  status?: number;
  network: boolean;
  constructor(message: string, opts: { code?: KioskErrorCode; status?: number; network?: boolean } = {}) {
    super(message);
    this.name = 'KioskApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.network = !!opts.network;
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

const newRequestId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2, 14)}`);

/** API ห่อคำตอบเป็น { success, data } (TransformInterceptor) — แกะให้ */
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
    const next = pickString(body.nextDeviceToken) ?? pickString(raw.nextDeviceToken);
    if (next) updateToken(next);
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
    if (e.network && retry) {
      await sleep(1500);
      return post<T>(path, body, false); // requestId เดิมอยู่ใน body แล้ว → ได้คำตอบเดิมถ้าคำขอแรกถึงเซิร์ฟเวอร์
    }
    throw e;
  }
}

export const kioskApi = {
  async register(code: string, deviceName: string): Promise<RegisterResponse> {
    return post<RegisterResponse>('/kiosk/register', { code, deviceName });
  },

  async heartbeat(token: string): Promise<HeartbeatResponse> {
    const out = await post<HeartbeatResponse>('/kiosk/heartbeat', { deviceToken: token, requestId: newRequestId() });
    if (out.nextDeviceToken) updateToken(out.nextDeviceToken);
    return out;
  },

  async punch(input: { token: string; pin: string; kind: 'IN' | 'OUT'; photo?: Blob; geo?: { lat: number; lng: number } }): Promise<PunchResponse> {
    const form = new FormData();
    form.set('deviceToken', input.token);
    form.set('requestId', newRequestId());
    form.set('pin', input.pin);
    form.set('kind', input.kind);
    if (input.geo) {
      form.set('geoLat', String(input.geo.lat));
      form.set('geoLng', String(input.geo.lng));
    }
    if (input.photo) form.set('photo', input.photo, 'photo.jpg');
    const out = await post<PunchResponse>('/kiosk/punch', form);
    if (out.nextDeviceToken) updateToken(out.nextDeviceToken);
    return out;
  },
};
