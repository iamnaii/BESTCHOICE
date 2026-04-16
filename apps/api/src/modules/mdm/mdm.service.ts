import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MDM PJ-Soft Proxy API Client
 *
 * Base URL : https://mdm-th.com
 * Auth     : X-API-Key header
 * Rate     : 100 req / 60s sliding window
 * Docs     : docs/references/MDM-Proxy-API-Documentation.md
 *
 * 40 endpoints across 9 categories.
 * This service wraps the ones BESTCHOICE actually uses.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MdmDevice {
  id: number;
  deviceId: string; // serial number
  deviceName: string;
  imei: string;
  name: string; // customer name
  phone: string;
  deviceLock: 0 | 1; // 0=Locked, 1=Unlocked
  status: 0 | 1 | 2; // 0=Not managed, 1=Managed, 2=Unmanaged
  lossStatus: 0 | 1; // 0=Normal, 1=Lost mode
  modelType: 0 | 1 | 2; // 0=iPhone, 1=iPad, 2=Mac
  productName: string;
  osVersion: string;
  isDel: 0 | 1 | 2;
  lastTime: string;
}

export interface MdmDeviceType {
  id: number;
  name: string;
}

export interface MdmDeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
}

export interface MdmOperationLog {
  id: number;
  deviceId: number;
  action: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface MdmActionResult {
  success: boolean;
  message: string;
  deviceId?: number;
}

export interface MdmResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

export interface MdmErrorResponse {
  error: string;
  message: string;
  reference_id?: string;
  reset_at?: string;
}

export interface MdmRateLimit {
  limit: number;
  remaining: number;
  resetAt: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MdmService {
  private readonly logger = new Logger(MdmService.name);
  private rateLimit: MdmRateLimit | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // ─── Configuration ──────────────────────────────────────

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  getStatus(): { configured: boolean; baseUrl: string; message: string; rateLimit: MdmRateLimit | null } {
    return {
      configured: this.isConfigured(),
      baseUrl: this.getBaseUrl(),
      message: this.isConfigured()
        ? 'MDM PJ-Soft เชื่อมต่อแล้ว'
        : 'ยังไม่ได้ตั้งค่า — ต้องการ MDM_API_KEY',
      rateLimit: this.rateLimit,
    };
  }

  private getApiKey(): string {
    return this.configService.get('MDM_API_KEY') || '';
  }

  private getBaseUrl(): string {
    return this.configService.get('MDM_BASE_URL') || 'https://mdm-th.com';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  1) AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/mdm/get-authorization — get auth token */
  async getAuthorization(): Promise<MdmResponse<string>> {
    return this.apiPost('/api/mdm/get-authorization');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  2) DEVICE MANAGEMENT — lookup
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/mdm/devices — list devices with filters */
  async listDevices(params?: {
    pageNum?: number;
    pageSize?: number;
    status?: 0 | 1 | 2;
    modelType?: 0 | 1 | 2;
    isDel?: 0 | 1 | 2;
    lossStatus?: 0 | 1;
    name?: string;
    phone?: string;
    deviceId?: string;
  }): Promise<{ total: number; devices: MdmDevice[] }> {
    if (!this.isConfigured()) return { total: 0, devices: [] };

    const query = new URLSearchParams();
    if (params?.pageNum) query.set('pageNum', String(params.pageNum));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.modelType !== undefined) query.set('modelType', String(params.modelType));
    if (params?.isDel !== undefined) query.set('isDel', String(params.isDel));
    if (params?.lossStatus !== undefined) query.set('lossStatus', String(params.lossStatus));
    if (params?.name) query.set('name', params.name);
    if (params?.phone) query.set('phone', params.phone);
    if (params?.deviceId) query.set('deviceId', params.deviceId);

    const qs = query.toString();
    const result = await this.apiGet<{ total: number; rows: MdmDevice[] }>(
      `/api/mdm/devices${qs ? `?${qs}` : ''}`,
    );
    return { total: result?.data?.total || 0, devices: result?.data?.rows || [] };
  }

  /** GET /api/mdm/devices/types — device types (iPhone, iPad, Mac) */
  async getDeviceTypes(): Promise<MdmDeviceType[]> {
    if (!this.isConfigured()) return [];
    const result = await this.apiGet<MdmDeviceType[]>('/api/mdm/devices/types');
    return result?.data || [];
  }

  /** GET /api/mdm/devices/{id} — device detail by MDM ID */
  async getDeviceById(id: number): Promise<MdmDevice | null> {
    if (!this.isConfigured()) return null;
    const result = await this.apiGet<MdmDevice>(`/api/mdm/devices/${id}`);
    return result?.data || null;
  }

  /** GET /api/mdm/devices/imei/{imei} — device by IMEI (dedicated endpoint) */
  async findDeviceByImei(imei: string): Promise<MdmDevice | null> {
    if (!this.isConfigured()) return null;
    const result = await this.apiGet<MdmDevice>(`/api/mdm/devices/imei/${encodeURIComponent(imei)}`);
    return result?.data || null;
  }

  /** GET /api/mdm/devices/by-serial?deviceId=XXX — device by serial number */
  async findDeviceBySerial(serial: string): Promise<MdmDevice | null> {
    if (!this.isConfigured()) return null;
    const result = await this.apiGet<MdmDevice>(
      `/api/mdm/devices/by-serial?deviceId=${encodeURIComponent(serial)}`,
    );
    return result?.data || null;
  }

  /** GET /api/mdm/devices/location?id=XXX — device GPS location */
  async getDeviceLocation(id: number): Promise<MdmDeviceLocation | null> {
    if (!this.isConfigured()) return null;
    const result = await this.apiGet<MdmDeviceLocation>(`/api/mdm/devices/location?id=${id}`);
    return result?.data || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3) DEVICE MANAGEMENT — mutations
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/mdm/devices — add new device */
  async addDevice(deviceId: string, name: string, phone: string): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices', { deviceId, name, phone });
  }

  /** POST /api/mdm/devices/edit — edit device info */
  async editDevice(id: number, name: string, phone: string, deviceName: string, isDel: 0 | 1 = 0): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/edit', { id, name, phone, deviceName, isDel });
  }

  /** POST /api/mdm/devices/lock — lock device screen */
  async lockDeviceScreen(id: number): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/lock', { id });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4) SECURITY — Lost Mode (core for BESTCHOICE overdue flow)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/mdm/devices/lost-mode — enable Lost Mode
   * Used for overdue contracts — shows message + phone on lock screen.
   */
  async enableLostMode(id: number, dialPhone: string, message: string): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/lost-mode', { id, dialPhone, message });
  }

  /**
   * POST /api/mdm/devices/lost-mode/disable — disable Lost Mode
   * Used after payment received — restores normal device usage.
   */
  async disableLostMode(id: number): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/lost-mode/disable', { id });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  5) SECURITY — other
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/mdm/devices/activation-lock/query */
  async queryActivationLock(query: Record<string, string> = {}): Promise<MdmResponse> {
    const qs = new URLSearchParams(query).toString();
    return this.apiGet(`/api/mdm/devices/activation-lock/query${qs ? `?${qs}` : ''}`);
  }

  /** POST /api/mdm/devices/activation-lock */
  async sendActivationLock(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/activation-lock', data);
  }

  /** POST /api/mdm/devices/activation-lock/remove */
  async removeActivationLock(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/activation-lock/remove', data);
  }

  /** POST /api/mdm/devices/lock-screen-password — remove lock screen password */
  async removeLockScreenPassword(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/lock-screen-password', data);
  }

  /** POST /api/mdm/devices/update-system — trigger OS update */
  async updateSystem(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/update-system', data);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  6) POLICIES & RESTRICTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/mdm/restrictions/{id} */
  async getDeviceRestrictions(id: number): Promise<MdmResponse> {
    return this.apiGet(`/api/mdm/restrictions/${id}`);
  }

  /** POST /api/mdm/restrictions */
  async installRestrictions(id: number, options: Record<string, number>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/restrictions', { id, ...options });
  }

  /** POST /api/mdm/devices/lock-screen-text */
  async setLockScreenText(id: number, message: string): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/lock-screen-text', { id, message });
  }

  /** GET /api/mdm/wallpapers */
  async getWallpapers(): Promise<MdmResponse> {
    return this.apiGet('/api/mdm/wallpapers');
  }

  /** POST /api/mdm/wallpaper/set */
  async setWallpaper(deviceId: number, imageId: number): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/wallpaper/set', { id: deviceId, imageId });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  7) APPLICATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/mdm/apps */
  async getAppList(pageNum = 1, pageSize = 10): Promise<MdmResponse> {
    return this.apiGet(`/api/mdm/apps?pageNum=${pageNum}&pageSize=${pageSize}`);
  }

  /** GET /api/mdm/devices/apps/{id} */
  async getDeviceApps(deviceId: number): Promise<MdmResponse> {
    return this.apiGet(`/api/mdm/devices/apps/${deviceId}`);
  }

  /** POST /api/mdm/apps/install */
  async installApp(deviceId: number, appId: number): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/apps/install', { id: deviceId, appId });
  }

  /** POST /api/mdm/apps/restrictions */
  async setAppRestriction(deviceId: number, bundleId: string, restricted: 0 | 1): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/apps/restrictions', { id: deviceId, bundleId, restricted });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  8) OPERATIONS & LOGS
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/mdm/devices/operations */
  async getOperationLogs(query: Record<string, string> = {}): Promise<MdmResponse> {
    const qs = new URLSearchParams(query).toString();
    return this.apiGet(`/api/mdm/devices/operations${qs ? `?${qs}` : ''}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  9) ADVANCED OPERATIONS (⚠️ destructive)
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/mdm/devices/unlock — One Click Unlock (removes MDM profile!) */
  async oneClickUnlock(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/unlock', data);
  }

  /** POST /api/mdm/devices/abm/unbind — unbind ABM */
  async unbindAbm(data: Record<string, unknown>): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/abm/unbind', data);
  }

  /** POST /api/mdm/devices/erase — ⚠️ WIPE DEVICE (deletes all data!) */
  async eraseDevice(id: number): Promise<MdmResponse> {
    return this.apiPost('/api/mdm/devices/erase', { id });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HIGH-LEVEL BUSINESS METHODS (used by MdmAutoService)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lock device for overdue contract — find by IMEI, enable Lost Mode.
   * This is the main method called by auto-lock cron.
   */
  async lockDeviceByImei(imei: string, reason: string): Promise<MdmActionResult> {
    if (!this.isConfigured()) {
      return { success: false, message: 'MDM ยังไม่ได้ตั้งค่า' };
    }

    const device = await this.findDeviceByImei(imei);
    if (!device) {
      return { success: false, message: `ไม่พบเครื่อง IMEI: ${imei} ในระบบ MDM` };
    }

    if (device.lossStatus === 1) {
      return { success: true, message: 'เครื่องถูกล็อคอยู่แล้ว', deviceId: device.id };
    }

    const shopPhone = this.configService.get('SHOP_PHONE') || '0800000000';
    const result = await this.enableLostMode(
      device.id,
      shopPhone,
      `กรุณาติดต่อร้าน BESTCHOICE เพื่อชำระค่างวด | ${reason}`,
    );

    const success = result?.code === 200;
    if (success) {
      this.logger.log(`MDM: Lost Mode enabled for ${imei} (ID: ${device.id}) — ${reason}`);
    } else {
      this.logger.error(`MDM: failed to enable Lost Mode for ${imei} — ${result?.msg}`);
      Sentry.captureMessage(`MDM lock failed: ${imei}`, {
        level: 'warning',
        extra: { deviceId: device.id, reason, response: result },
      });
    }

    return {
      success,
      message: result?.msg || (success ? 'ล็อคเครื่องสำเร็จ' : 'ล็อคเครื่องไม่สำเร็จ'),
      deviceId: device.id,
    };
  }

  /**
   * Unlock device after payment — find by IMEI, disable Lost Mode.
   * This is the main method called by auto-unlock.
   */
  async unlockDeviceByImei(imei: string): Promise<MdmActionResult> {
    if (!this.isConfigured()) {
      return { success: false, message: 'MDM ยังไม่ได้ตั้งค่า' };
    }

    const device = await this.findDeviceByImei(imei);
    if (!device) {
      return { success: false, message: `ไม่พบเครื่อง IMEI: ${imei} ในระบบ MDM` };
    }

    // Already unlocked — skip API call to preserve rate limit
    if (device.lossStatus !== 1) {
      return { success: true, message: 'เครื่องไม่ได้อยู่ใน Lost Mode', deviceId: device.id };
    }

    const result = await this.disableLostMode(device.id);

    const success = result?.code === 200;
    if (success) {
      this.logger.log(`MDM: Lost Mode disabled for ${imei} (ID: ${device.id})`);
    } else {
      this.logger.error(`MDM: failed to disable Lost Mode for ${imei} — ${result?.msg}`);
    }

    return {
      success,
      message: result?.msg || (success ? 'ปลดล็อคเครื่องสำเร็จ' : 'ปลดล็อคไม่สำเร็จ'),
      deviceId: device.id,
    };
  }

  /** Get device status by IMEI — used by controller + contract detail */
  async getDeviceStatus(imei: string): Promise<{
    found: boolean;
    device: MdmDevice | null;
    lockStatus: string;
  }> {
    if (!this.isConfigured()) {
      return { found: false, device: null, lockStatus: 'MDM ยังไม่ได้ตั้งค่า' };
    }

    const device = await this.findDeviceByImei(imei);
    if (!device) {
      return { found: false, device: null, lockStatus: 'ไม่พบในระบบ MDM' };
    }

    const lockStatus =
      device.lossStatus === 1
        ? 'ถูกล็อค (Lost Mode)'
        : device.deviceLock === 0
          ? 'ล็อคหน้าจอ'
          : 'ปลดล็อคแล้ว';

    return { found: true, device, lockStatus };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HTTP CLIENT
  // ═══════════════════════════════════════════════════════════════════════════

  private async apiGet<T = unknown>(path: string): Promise<MdmResponse<T>> {
    return this.request<T>('GET', path);
  }

  private async apiPost<T = unknown>(path: string, body?: unknown): Promise<MdmResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<MdmResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const url = `${this.getBaseUrl()}${path}`;
      const options: RequestInit = {
        method,
        headers: {
          'X-API-Key': this.getApiKey(),
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (body && method === 'POST') {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);
      clearTimeout(timeout);

      // Track rate limits from response headers
      this.updateRateLimit(res.headers);

      // Handle rate limit
      if (res.status === 429) {
        const errorData = (await res.json().catch(() => ({}))) as MdmErrorResponse;
        this.logger.warn(`MDM rate limited — reset at: ${errorData.reset_at}`);
        return { code: 429, msg: `Rate limited — ลองใหม่หลัง ${errorData.reset_at || 'unknown'}` };
      }

      // Handle auth errors
      if (res.status === 401 || res.status === 403) {
        const errorData = (await res.json().catch(() => ({}))) as MdmErrorResponse;
        this.logger.error(`MDM auth error (${res.status}): ${errorData.message}`);
        return { code: res.status, msg: errorData.message || `Auth error ${res.status}` };
      }

      const data = (await res.json().catch(() => ({ code: res.status, msg: `Unexpected response from MDM (HTTP ${res.status})` }))) as MdmResponse<T>;
      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.error(`MDM API timeout (15s): ${method} ${path}`);
        Sentry.captureMessage('mdm-api-timeout', {
          level: 'warning',
          tags: { kind: 'mdm-api' },
          extra: { method, path },
        });
        return { code: 0, msg: 'MDM API timeout (15s)' };
      }
      Sentry.captureException(err, { tags: { kind: 'mdm-api' }, extra: { method, path } });
      return { code: 0, msg: (err as Error).message };
    }
  }

  private updateRateLimit(headers: Headers): void {
    const limit = headers.get('X-RateLimit-Limit');
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');

    if (limit && remaining && reset) {
      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetAt: parseInt(reset, 10),
      };

      if (this.rateLimit.remaining < 10) {
        this.logger.warn(`MDM rate limit low: ${this.rateLimit.remaining}/${this.rateLimit.limit} remaining`);
      }
    }
  }
}
