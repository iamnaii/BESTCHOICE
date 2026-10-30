import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * ข้อผิดพลาดของเครื่องตอกบัตร (ก้อน 10 D3 · รีวิว C1/C2/I5)
 * - เครื่องอ่าน `code` เพื่อตัดสินว่า "ลองใหม่ได้" (REQUEST_BUSY) / "ต้องลงทะเบียนใหม่" (DEVICE_REVOKED) / "ล็อก" (DEVICE_LOCKED) / รหัสผิด
 * - filter กลางของแอป (SentryExceptionFilter) ตัดฟิลด์นอก allow-list ทิ้ง ⇒ controller เครื่องตอกบัตรใช้ filter ของตัวเอง
 */
export const REQUEST_BUSY_CODE = 'REQUEST_BUSY';

export class KioskBusyException extends ConflictException {
  constructor() {
    super({ code: REQUEST_BUSY_CODE, message: 'เครื่องกำลังบันทึกคำขอก่อนหน้า — กดลองใหม่อีกครั้ง' });
  }
}

/** แข่งกันหมุน token / requestId ซ้ำพร้อมกัน / serialization ⇒ ให้เครื่องลองใหม่ด้วยคำขอเดิม (ไม่ใช่ token ถูกคัดลอก) */
export function asKioskRetryable(err: unknown): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P2002' || code === 'P2034') return new KioskBusyException();
  return err;
}

const DEFAULT_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  423: 'LOCKED',
  429: 'RATE_LIMITED',
};

export interface KioskErrorBody {
  statusCode: number;
  code: string;
  message: string;
  serverTime: string;
}

@Catch()
export class KioskExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('KioskExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'SERVER_ERROR';
    let message = 'ระบบขัดข้อง ยังไม่ได้บันทึก — ลองใหม่อีกครั้ง';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = DEFAULT_CODE[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'REJECTED');
      const r = exception.getResponse();
      if (typeof r === 'string') message = r;
      else if (r && typeof r === 'object') {
        const body = r as Record<string, unknown>;
        if (typeof body.code === 'string') code = body.code;
        const m = Array.isArray(body.message) ? body.message[0] : body.message;
        if (typeof m === 'string' && m) message = m;
      }
      if (status >= 500) message = 'ระบบขัดข้อง ยังไม่ได้บันทึก — ลองใหม่อีกครั้ง';
    }
    if (status >= 500) {
      Sentry.captureException(exception, { tags: { subsystem: 'attendance', action: 'kiosk' } });
      this.logger.error(`kiosk → ${status}: ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`);
    }
    const body: KioskErrorBody = { statusCode: status, code, message, serverTime: new Date().toISOString() };
    response.status(status).json(body);
  }
}
