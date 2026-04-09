import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MDM PJ-Soft Integration Service
 *
 * API Docs: https://mdm-th.com/docs
 * Base URL: https://mdm-th.com
 * Auth: X-API-Key header
 * Rate limit: 100 req/hour
 *
 * Key endpoints for BESTCHOICE:
 * - POST /api/mdm/devices/lost-mode — lock overdue phone
 * - POST /api/mdm/devices/unlock — unlock after payment
 * - GET /api/mdm/devices — list/search devices by IMEI
 * - GET /api/mdm/devices/{id} — device status
 */

export interface MdmDevice {
  id: number;
  deviceId: string;
  deviceName: string;
  imei: string;
  name: string;
  phone: string;
  deviceLock: 0 | 1; // 0=Locked, 1=Unlocked
  status: 0 | 1 | 2; // 0=Not managed, 1=Managed, 2=Unmanaged
  lossStatus: 0 | 1; // 0=Not locked, 1=Lost mode
  modelType: 0 | 1 | 2; // 0=iPhone, 1=iPad, 2=Mac
  productName: string;
  osVersion: string;
  isDel: 0 | 1 | 2;
  lastTime: string;
}

export interface MdmActionResult {
  success: boolean;
  message: string;
  deviceId?: number;
}

@Injectable()
export class MdmService {
  private readonly logger = new Logger(MdmService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // ─── Configuration ──────────────────────────────────────

  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  getStatus(): { configured: boolean; baseUrl: string; message: string } {
    return {
      configured: this.isConfigured(),
      baseUrl: this.getBaseUrl(),
      message: this.isConfigured()
        ? 'MDM PJ-Soft เชื่อมต่อแล้ว'
        : 'ยังไม่ได้ตั้งค่า — ต้องการ MDM_API_KEY',
    };
  }

  private getApiKey(): string {
    return this.configService.get('MDM_API_KEY') || '';
  }

  private getBaseUrl(): string {
    return this.configService.get('MDM_BASE_URL') || 'https://mdm-th.com';
  }

  private getSubPassword(): string {
    return this.configService.get('MDM_SUB_PASSWORD') || '';
  }

  // ─── Device Lookup ──────────────────────────────────────

  /** Find device by IMEI */
  async findDeviceByImei(imei: string): Promise<MdmDevice | null> {
    if (!this.isConfigured()) return null;

    const result = await this.apiGet<{ total: number; rows: MdmDevice[] }>(
      `/api/mdm/devices?deviceId=${encodeURIComponent(imei)}&pageSize=1`,
    );

    if (result?.rows?.length) {
      return result.rows[0];
    }
    return null;
  }

  /** Get device details by MDM ID */
  async getDeviceById(id: number): Promise<MdmDevice | null> {
    if (!this.isConfigured()) return null;

    const result = await this.apiGet<{ data: MdmDevice }>(`/api/mdm/devices/${id}`);
    return result?.data || null;
  }

  /** List devices with filters */
  async listDevices(params?: {
    pageNum?: number;
    pageSize?: number;
    status?: 0 | 1 | 2;
    lossStatus?: 0 | 1;
  }): Promise<{ total: number; devices: MdmDevice[] }> {
    if (!this.isConfigured()) return { total: 0, devices: [] };

    const query = new URLSearchParams();
    if (params?.pageNum) query.set('pageNum', String(params.pageNum));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.lossStatus !== undefined) query.set('lossStatus', String(params.lossStatus));

    const result = await this.apiGet<{ total: number; rows: MdmDevice[] }>(
      `/api/mdm/devices?${query.toString()}`,
    );
    return { total: result?.total || 0, devices: result?.rows || [] };
  }

  // ─── Device Actions ─────────────────────────────────────

  /** Lock device — set lost mode (for overdue contracts) */
  async lockDevice(imei: string, reason: string): Promise<MdmActionResult> {
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
    const result = await this.apiPost<{ code: number; msg: string }>('/api/mdm/devices/lost-mode', {
      id: device.id,
      dialPhone: shopPhone,
      message: `กรุณาติดต่อร้าน BESTCHOICE เพื่อชำระค่างวด | ${reason}`,
    });

    const success = result?.code === 200;
    if (success) {
      this.logger.log(`MDM: locked device ${imei} (ID: ${device.id}) — ${reason}`);
    } else {
      this.logger.error(`MDM: failed to lock device ${imei} — ${result?.msg}`);
      Sentry.captureMessage(`MDM lock failed: ${imei}`, {
        level: 'warning',
        extra: { deviceId: device.id, reason, response: result },
      });
    }

    return { success, message: result?.msg || (success ? 'ล็อคเครื่องสำเร็จ' : 'ล็อคเครื่องไม่สำเร็จ'), deviceId: device.id };
  }

  /** Unlock device (after payment received) */
  async unlockDevice(imei: string): Promise<MdmActionResult> {
    if (!this.isConfigured()) {
      return { success: false, message: 'MDM ยังไม่ได้ตั้งค่า' };
    }

    const device = await this.findDeviceByImei(imei);
    if (!device) {
      return { success: false, message: `ไม่พบเครื่อง IMEI: ${imei} ในระบบ MDM` };
    }

    const subPassword = this.getSubPassword();
    if (!subPassword) {
      return { success: false, message: 'MDM_SUB_PASSWORD ยังไม่ได้ตั้งค่า' };
    }

    const result = await this.apiPost<{ code: number; msg: string }>('/api/mdm/devices/unlock', {
      id: device.id,
      subPassword,
    });

    const success = result?.code === 200;
    if (success) {
      this.logger.log(`MDM: unlocked device ${imei} (ID: ${device.id})`);
    } else {
      this.logger.error(`MDM: failed to unlock device ${imei} — ${result?.msg}`);
    }

    return { success, message: result?.msg || (success ? 'ปลดล็อคเครื่องสำเร็จ' : 'ปลดล็อคไม่สำเร็จ'), deviceId: device.id };
  }

  /** Get device status by IMEI */
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

    const lockStatus = device.lossStatus === 1
      ? 'ถูกล็อค (Lost Mode)'
      : device.deviceLock === 0
        ? 'ล็อคหน้าจอ'
        : 'ปลดล็อคแล้ว';

    return { found: true, device, lockStatus };
  }

  // ─── HTTP Client ────────────────────────────────────────

  private async apiGet<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${this.getBaseUrl()}${path}`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.getApiKey(),
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await res.json() as T;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.error('MDM API timeout (15s)');
      }
      Sentry.captureException(err, { tags: { kind: 'mdm-api' } });
      return null;
    }
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${this.getBaseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.getApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await res.json() as T;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.error('MDM API timeout (15s)');
      }
      Sentry.captureException(err, { tags: { kind: 'mdm-api' } });
      return null;
    }
  }
}
