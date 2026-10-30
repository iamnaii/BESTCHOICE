import { BadRequestException, Body, Controller, HttpException, Post, Req, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { clientIp } from '../../utils/client-ip.util';
import { AttendanceDeviceService, type AuthenticatedDevice, type RotationContext } from './attendance-device.service';
import { KioskPunchService } from './kiosk-punch.service';
import { KioskExceptionFilter, asKioskRetryable } from './kiosk-errors';
import { HeartbeatKioskDto, PunchKioskDto, RegisterKioskDto } from './dto/kiosk.dto';

/**
 * เครื่องตอกบัตรประจำสาขา — endpoint สาธารณะแบบ token-gated (ก้อน 10 D3 · สเปก §4, §8)
 * ไม่มี JWT/session: ตัวตน = device token ที่หมุนเมื่องานสำเร็จ + requestId (ส่งซ้ำได้ผลเดิม) · ไม่มี CSRF (ไม่มี cookie) · throttle 30/นาที/IP
 * - token หมุนใน tx เดียวกับงาน (ตอก/heartbeat) ⇒ งานล้ม/รหัสผิด/409 = token เดิมยังใช้ได้ (รีวิว C1/C2)
 * - error ตอบผ่าน KioskExceptionFilter ของ controller นี้ ⇒ `code` ถึงเครื่อง (filter กลางตัดทิ้ง)
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
@UseFilters(new KioskExceptionFilter())
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
    const ctx = this.context(dto.requestId, req);
    const auth = await this.devices.authenticate({ deviceToken: dto.deviceToken, requestId: dto.requestId, ip: ctx.ip, userAgent: ctx.userAgent }, ctx.now);
    if (auth.replay) return this.replay(auth) as unknown as KioskHeartbeatResponse;
    try {
      const out = await this.devices.heartbeat(auth, ctx, (device) => ({
        serverTime: ctx.now.toISOString(),
        device: { status: device.status, name: device.name, branchName: device.branch?.name ?? '' },
      }));
      return { ...out.body, nextDeviceToken: out.nextToken };
    } catch (err) {
      throw asKioskRetryable(err);
    }
  }

  @Post('punch')
  @SkipCsrf()
  @Throttle(KIOSK_THROTTLE)
  @UseInterceptors(FileInterceptor('photo', PHOTO_UPLOAD))
  async punch(@Body() dto: PunchKioskDto, @UploadedFile() photo: Express.Multer.File | undefined, @Req() req: KioskRequest): Promise<KioskPunchResponse> {
    const ctx = this.context(dto.requestId, req);
    const auth = await this.devices.authenticate({ deviceToken: dto.deviceToken, requestId: dto.requestId, ip: ctx.ip, userAgent: ctx.userAgent }, ctx.now);
    if (auth.replay) return this.replay(auth) as unknown as KioskPunchResponse;

    const pin = await this.devices.checkPin(auth.device.id, dto.pin, ctx.now);
    if (pin === 'LOCKED') {
      const body = { code: 'PIN_LOCKED', message: 'เครื่องนี้พักรับรหัส 15 นาที (ใส่รหัสผิดหลายครั้ง)' };
      await this.devices.rememberError(auth.device.id, dto.requestId, 423, body);
      throw new HttpException(body, 423);
    }
    if (pin === 'INVALID') {
      const body = { code: 'PIN_INVALID', message: 'รหัสไม่ถูกต้อง' };
      await this.devices.rememberError(auth.device.id, dto.requestId, 400, body);
      throw new BadRequestException(body);
    }

    const geo = dto.geoLat && dto.geoLng ? { lat: Number(dto.geoLat), lng: Number(dto.geoLng) } : undefined;
    try {
      const outcome = await this.punchService.punch(
        { device: auth.device, userId: pin.userId, kind: dto.kind, photo: photo?.buffer?.length ? { buffer: photo.buffer, mimeType: photo.mimetype } : undefined, ip: ctx.ip, userAgent: ctx.userAgent, geo },
        ctx.now,
        (tx, result) => this.devices.commitRotation(tx, auth, ctx, { serverTime: ctx.now.toISOString(), result: { ...result, at: result.at.toISOString() } }),
      );
      const { nextToken, ...result } = outcome;
      return { nextDeviceToken: nextToken, serverTime: ctx.now.toISOString(), result: { ...result, at: result.at.toISOString() } };
    } catch (err) {
      // 409 ทางธุรกิจ (ตอกซ้ำ) อาจเกิดเพราะคำขอเดียวกันครั้งแรกเพิ่ง commit — ส่งคำตอบของครั้งแรกถ้ามี (รีวิวรอบ 2 C17)
      if (err instanceof HttpException && err.getStatus() < 500) {
        const late = await this.devices.replayIfCached(auth, dto.requestId);
        if (late) return this.replay({ ...auth, replay: late }) as unknown as KioskPunchResponse;
      }
      throw asKioskRetryable(err);
    }
  }

  /** คำตอบเดิมของ requestId นี้ — สำเร็จคืน body · error โยนสถานะเดิม (ผ่าน KioskExceptionFilter) */
  private replay(auth: AuthenticatedDevice): Record<string, unknown> {
    const { status, body } = auth.replay!;
    if (status >= 400) throw new HttpException(body, status);
    return body;
  }

  private context(requestId: string, req: KioskRequest): RotationContext {
    return { requestId, ip: clientIp(req), userAgent: this.userAgent(req), now: new Date() };
  }

  private userAgent(req: KioskRequest): string | undefined {
    const ua = req.headers?.['user-agent'];
    return typeof ua === 'string' ? ua.slice(0, 255) : undefined;
  }
}
