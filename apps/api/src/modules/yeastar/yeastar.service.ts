import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface YeastarExtension {
  number: string;
  name: string;
  status: string;
}

export interface YeastarCdrRecord {
  id: string;
  callFrom: string;
  callTo: string;
  callType: 'Inbound' | 'Outbound' | 'Internal';
  startTime: string;
  duration: number;
  talkDuration: number;
  answeredBy?: string;
  recordingFile?: string;
}

@Injectable()
export class YeastarService {
  private readonly logger = new Logger(YeastarService.name);

  constructor(
    private readonly tokenService: YeastarTokenService,
    private readonly configService: IntegrationConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** ค้นหา agent extension + customer phone แล้วสั่ง originate */
  async originateForUser(
    userId: string,
    customerId: string,
  ): Promise<{ callId: string }> {
    const agent = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { yeastarExtension: true },
    });
    if (!agent?.yeastarExtension) {
      throw new BadRequestException('กรุณาตั้ง Extension Yeastar ใน Profile ก่อนโทรออก');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { phone: true },
    });
    if (!customer?.phone) {
      throw new BadRequestException('ไม่พบเบอร์โทรของลูกค้า');
    }

    return this.originateCall(agent.yeastarExtension, customer.phone);
  }

  /**
   * โทรไปยังเบอร์อะไรก็ได้ (เช่น บุคคลอ้างอิงในใบสมัครลูกค้า) — ไม่ผูกกับ customerId
   * เพราะ ref ไม่ใช่ลูกค้าในระบบ. CallLog จะไม่ถูกสร้างจาก CDR webhook
   * ถ้าเบอร์ปลายทางไม่ตรงกับลูกค้าใน DB.
   */
  async originateForUserToPhone(
    userId: string,
    rawPhone: string,
  ): Promise<{ callId: string }> {
    const phone = (rawPhone ?? '').replace(/[^\d+]/g, '');
    if (!phone || phone.length < 8) {
      throw new BadRequestException('เบอร์ปลายทางไม่ถูกต้อง');
    }
    const agent = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { yeastarExtension: true },
    });
    if (!agent?.yeastarExtension) {
      throw new BadRequestException('กรุณาตั้ง Extension Yeastar ใน Profile ก่อนโทรออก');
    }
    return this.originateCall(agent.yeastarExtension, phone);
  }

  private async pbxUrl(): Promise<string> {
    const config = await this.configService.getConfig('yeastar');
    return config.pbxUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const url = `${base}/openapi/v1.0${path}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BESTCHOICE/1.0',
          Authorization: `Bearer ${token}`,
          ...(options.headers ?? {}),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`[Yeastar] ${path} → ${res.status}: ${text}`);
        Sentry.captureMessage(`[Yeastar] API error ${path}: ${res.status}`, 'error');
        throw new ServiceUnavailableException(`Yeastar API error: ${res.status}`);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        Sentry.captureMessage(`[Yeastar] timeout ${path}`, 'warning');
        throw new ServiceUnavailableException('Yeastar API timeout');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** สั่งโทรออก: PBX โทรหา extension ก่อน แล้วค่อยต่อไปหา callee */
  async originateCall(extensionNumber: string, callee: string): Promise<{ callId: string }> {
    const data = await this.request<{ call_id: string }>('/call/dial', {
      method: 'POST',
      body: JSON.stringify({ caller: extensionNumber, callee }),
    });
    return { callId: data.call_id };
  }

  /** ดึง extension ทั้งหมดจาก PBX */
  async getExtensions(): Promise<YeastarExtension[]> {
    const data = await this.request<{
      extension_list: Array<{ number: string; name: string; status: string }>;
    }>('/extension/list');
    return (data.extension_list ?? []).map((e) => ({
      number: e.number,
      name: e.name,
      status: e.status,
    }));
  }

  /** ทดสอบ connection — return true ถ้าเชื่อมต่อได้ */
  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.getExtensions();
      return { ok: true, message: 'เชื่อมต่อ Yeastar สำเร็จ' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'เชื่อมต่อไม่ได้' };
    }
  }

  /** ดึง CDR ตาม time range (epoch seconds) */
  async queryCdr(startTime: number, endTime: number): Promise<YeastarCdrRecord[]> {
    const qs = new URLSearchParams({
      start_time: String(startTime),
      end_time: String(endTime),
    });
    const data = await this.request<{ cdr_list?: YeastarCdrRecord[] }>(
      `/cdr/search?${qs.toString()}`,
    );
    return data.cdr_list ?? [];
  }

  /** ดาวน์โหลด recording file จาก Yeastar → return Buffer */
  async downloadRecording(recordingPath: string): Promise<Buffer> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const qs = new URLSearchParams({ recording_file: recordingPath });
    const url = `${base}/openapi/v1.0/recording/download?${qs.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'BESTCHOICE/1.0',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`[Yeastar] recording download failed: ${res.status}`);
      }

      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }
}
