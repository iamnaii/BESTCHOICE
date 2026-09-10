import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Company, resolveCompanyAccess } from '@installment/shared';

/**
 * SP7.1 (เขียนใหม่ 2026-09-10) — ตัดสิน company scope ของ request แล้วเขียนลง req.entityScope
 *
 * ทำไมเป็น interceptor ไม่ใช่ global guard:
 *   Nest 11 ประกอบ guard chain เป็น [...global, ...class, ...method]
 *   (node_modules/@nestjs/core/helpers/context-creator.js:11-15) และ JwtAuthGuard ในบ้านนี้เป็น
 *   per-controller (152 จาก 171 controller) → global guard จะรันก่อน JwtAuthGuard เสมอ และเห็น
 *   req.user เป็น undefined ตลอด กับดักนี้กินเหยื่อไปแล้วหนึ่งราย: JwtAudienceGuard ที่ลงเป็น
 *   APP_GUARD ใน app.module.ts มี `if (!req.user) return true` จึงเป็น no-op เงียบมาตลอด
 *   interceptor ไม่ติดกับดักนี้เพราะทำงานหลัง guard ทุกตัวเสมอ หลักฐานเชิงประจักษ์คือ
 *   AuditInterceptor (modules/audit/audit.interceptor.ts:20) ซึ่งเป็น APP_INTERCEPTOR อ่าน
 *   request.user ได้จริงและเขียน audit_logs.userId บน prod มาตลอด
 *
 * ก่อนหน้านี้ตรรกะนี้อยู่ใน EntityScopeMiddleware ซึ่งรัน *ก่อน* guard ทุกตัว จึงเห็น
 * req.user เป็น undefined แล้ว `return next()` ทุก request — ไม่เคยตรวจอะไรเลยตั้งแต่วันแรก
 * (SentryEntityTagMiddleware ที่อ่าน req.entityScope ต่อจากมันก็ตายด้วยเหตุผลเดียวกัน ตรรกะติด
 * tag จึงย้ายเข้ามาอยู่ในไฟล์นี้)
 *
 * กฎ accessibleCompanies ว่าง: ว่าง = "ยังไม่ตั้งค่า" ไม่ใช่ "ไม่มีสิทธิ์" → resolveCompanyAccess
 * คืนค่า default ของ role ให้ (packages/shared/src/company-access.ts) การ 403 ใส่ array ว่าง
 * คือต้นเหตุของ outage 2026-09-08 ห้ามคืนพฤติกรรมนั้นกลับมา
 *
 * เจตนา: ถ้า request ไม่ได้ระบุ company มา จะ **ไม่เขียน** req.entityScope เลย (ทิ้ง precedence
 * ข้อ 3-4 ของ middleware เดิม คือ primaryCompany และ default 'SHOP') เพื่อไม่ปลุก tax scoping
 * ที่หลับอยู่ให้ตื่นพร้อมกับการแก้ครั้งนี้ — tax-report.service.ts:120-122 จะยังไม่กรองด้วย
 * companyCode และ tax-entity.util.ts จะยังไม่ปฏิเสธ PP30 ของ client ที่ไม่ส่ง company
 * blast radius จึงเหลือแค่ "request ที่ระบุ company มาชัด ๆ แต่ไม่มีสิทธิ์" เท่านั้น
 */
@Injectable()
export class EntityScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as
      | {
          role?: string;
          accessibleCompanies?: string[];
          primaryCompany?: string | null;
          aud?: string;
        }
      | undefined;

    // ยกเว้น 1: ไม่มี user = public / @Public / LIFF (liff-token.guard เขียน liffUserId ไม่ใช่ user) / webhook
    if (!user) return next.handle();

    // ยกเว้น 2: token ฝั่งลูกค้าหน้าร้าน — principal ตัวนี้ไม่มีฟิลด์ companies เลย
    if (user.aud === 'shop' || user.role === 'CUSTOMER') return next.handle();

    const requested = this.resolveRequested(req);

    // ยกเว้น 3: ไม่ได้ระบุ company มา = ไม่ตรวจ และไม่เขียน entityScope (ดู docblock)
    if (!requested) return next.handle();

    const access = resolveCompanyAccess(
      user.role ?? '',
      user.accessibleCompanies,
      user.primaryCompany,
    );

    if (!access.accessible.includes(requested)) {
      throw new ForbiddenException(`ผู้ใช้ไม่มีสิทธิ์เข้าถึง company ${requested}`);
    }

    req.entityScope = requested;
    this.tagSentry(requested);

    return next.handle();
  }

  private resolveRequested(req: Request): Company | null {
    const fromQuery = String(req.query?.company ?? '').toUpperCase();
    if (fromQuery === 'SHOP' || fromQuery === 'FINANCE') return fromQuery;

    const fromHeader = String(req.headers?.['x-company-scope'] ?? '').toUpperCase();
    if (fromHeader === 'SHOP' || fromHeader === 'FINANCE') return fromHeader;

    return null;
  }

  /**
   * SP7.8 — ติด entity_scope เป็น Sentry tag เพื่อให้กรอง error แยกตามนิติบุคคลได้
   * lazy-require เพราะ @sentry/nestjs เป็น optional จากมุมมอง runtime (SENTRY_DSN ไม่ตั้งใน dev)
   * ต้องไม่ throw และต้องไม่บล็อก request ไม่ว่าเกิดอะไรขึ้น
   */
  private tagSentry(scope: Company) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nestjs') as typeof import('@sentry/nestjs');
      // configureScope มีใน SDK ≥6 ส่วน ≥8 เลิกใช้แล้วหันไป getCurrentScope —
      // เช็คทั้งสองทางเพื่อไม่ให้พังตอนอัป SDK
      if (typeof (Sentry as Record<string, unknown>).configureScope === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Sentry as any).configureScope((s: { setTag: (k: string, v: string) => void }) => {
          s.setTag('entity_scope', scope);
        });
      } else if (typeof (Sentry as Record<string, unknown>).withScope === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Sentry as any).getCurrentScope?.()?.setTag('entity_scope', scope);
      }
    } catch {
      // Sentry ไม่ได้ติดตั้ง / ยังไม่ init — ข้ามเงียบ ๆ
    }
  }
}
