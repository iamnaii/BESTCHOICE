import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

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
  ) {}

  private async pbxUrl(): Promise<string> {
    const config = await this.configService.getConfig('yeastar');
    return config.pbxUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const url = `${base}/openapi/v1.0${path}?access_token=${token}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BESTCHOICE/1.0',
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
    const data = await this.request<{ cdr_list?: YeastarCdrRecord[] }>(
      `/cdr/search?start_time=${startTime}&end_time=${endTime}`,
    );
    return data.cdr_list ?? [];
  }

  /** ดาวน์โหลด recording file จาก Yeastar → return Buffer */
  async downloadRecording(recordingPath: string): Promise<Buffer> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const url = `${base}/openapi/v1.0/recording/download?access_token=${token}&recording_file=${encodeURIComponent(recordingPath)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BESTCHOICE/1.0' },
    });

    if (!res.ok) {
      throw new Error(`[Yeastar] recording download failed: ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }
}
