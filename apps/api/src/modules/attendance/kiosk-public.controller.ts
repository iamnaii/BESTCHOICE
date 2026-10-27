import { BadRequestException, Body, Controller, HttpException, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { clientIp } from '../../utils/client-ip.util';
import { AttendanceDeviceService } from './attendance-device.service';
import { KioskPunchService } from './kiosk-punch.service';
import { HeartbeatKioskDto, PunchKioskDto, RegisterKioskDto } from './dto/kiosk.dto';

/**
 * เครื่องตอกบัตรประจำสาขา — endpoint สาธารณะแบบ token-gated (ก้อน 10 D3 · สเปก §4, §8)
 * ไม่มี JWT/session: ตัวตน = device token ที่หมุนทุกคำขอ + requestId (ส่งซ้ำได้ผลเดิม) · ไม่มี CSRF (ไม่มี cookie) · throttle 30/นาที/IP
 * ลงทะเบียนใน access manifest เป็น `public` และในรายการ Intentionally Public Endpoints ของ .claude/rules/security.md
 */
const KIOSK_THROTTLE = { short: { limit: 30, ttl: 60_000 } };
const PHOTO_UPLOAD = { limits: { fileSize: 300 * 1024, files: 1 } };

type KioskRequest = Request;

export interface KioskHeartbeatResponse {
  nextDeviceToken?: string;
  serverTime: string;
  device: { status: string; name: string; branchName: string };
}

export interface KioskPunchResponse {
  nextDeviceToken?: string;
  serverTime: string;
  result: { nickname: string; kind: 'IN' | 'OUT'; at: string; status: string; lateMinutes: number; otHours: number; flags: string[] };
}

@Controller('kiosk')
export class KioskPublicController {
  constructor(
    private readonly devices: AttendanceDeviceService,
    private readonly punchService: KioskPunchService,
  ) {}

  @Post('register')
  @SkipCsrf()
  @Throttle(KIOSK_THROTTLE)
  async register(@Body() dto: RegisterKioskDto, @Req() req: KioskRequest) {
    const now = new Date();
    const out = await this.devices.register({ code: dto.code, deviceName: dto.deviceName, ip: clientIp(req), userAgent: this.userAgent(req) }, now);
    return { deviceToken: out.deviceToken, branch: { id: out.device.branchId, name: out.device.branchName }, device: { id: out.device.id, name: out.device.name }, serverTime: now.toISOString() };
  }

  @Post('heartbeat')
  @SkipCsrf()
  @Throttle(KIOSK_THROTTLE)
  async heartbeat(@Body() dto: HeartbeatKioskDto, @Req() req: KioskRequest): Promise<KioskHeartbeatResponse> {
    const now = new Date();
    const auth = await this.devices.authenticate({ deviceToken: dto.deviceToken, requestId: dto.requestId, ip: clientIp(req), userAgent: this.userAgent(req) }, now);
    if (auth.cached) return auth.cached as KioskHeartbeatResponse;
    await this.devices.touchCleanHeartbeat(auth.device.id, now);
    const body: KioskHeartbeatResponse = {
      nextDeviceToken: auth.nextToken,
      serverTime: now.toISOString(),
      device: { status: auth.device.status, name: auth.device.name, branchName: auth.device.branch?.name ?? '' },
    };
    await this.devices.remember(auth.device.id, dto.requestId, body);
    return body;
  }

  @Post('punch')
  @SkipCsrf()
  @Throttle(KIOSK_THROTTLE)
  @UseInterceptors(FileInterceptor('photo', PHOTO_UPLOAD))
  async punch(@Body() dto: PunchKioskDto, @UploadedFile() photo: Express.Multer.File | undefined, @Req() req: KioskRequest): Promise<KioskPunchResponse> {
    const now = new Date();
    const ip = clientIp(req);
    const userAgent = this.userAgent(req);
    const auth = await this.devices.authenticate({ deviceToken: dto.deviceToken, requestId: dto.requestId, ip, userAgent }, now);
    if (auth.cached) return auth.cached as KioskPunchResponse;

    const pin = await this.devices.checkPin(auth.device.id, dto.pin, now);
    if (pin === 'LOCKED') {
      const body = { code: 'PIN_LOCKED', message: 'เครื่องนี้พักรับรหัส 15 นาที (ใส่รหัสผิดหลายครั้ง)', nextDeviceToken: auth.nextToken, serverTime: now.toISOString() };
      await this.devices.remember(auth.device.id, dto.requestId, body);
      throw new HttpException(body, 423);
    }
    if (pin === 'INVALID') {
      const body = { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง', nextDeviceToken: auth.nextToken, serverTime: now.toISOString() };
      await this.devices.remember(auth.device.id, dto.requestId, body);
      throw new BadRequestException(body);
    }

    const geo = dto.geoLat && dto.geoLng ? { lat: Number(dto.geoLat), lng: Number(dto.geoLng) } : undefined;
    const result = await this.punchService.punch(
      {
        device: auth.device,
        userId: pin.userId,
        kind: dto.kind,
        photo: photo?.buffer?.length ? { buffer: photo.buffer, mimeType: photo.mimetype } : undefined,
        ip,
        userAgent,
        geo,
      },
      now,
    );
    const body: KioskPunchResponse = { nextDeviceToken: auth.nextToken, serverTime: now.toISOString(), result: { ...result, at: result.at.toISOString() } };
    await this.devices.remember(auth.device.id, dto.requestId, body);
    return body;
  }

  private userAgent(req: KioskRequest): string | undefined {
    const ua = req.headers?.['user-agent'];
    return typeof ua === 'string' ? ua.slice(0, 255) : undefined;
  }
}
