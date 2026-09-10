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
 * precedence เหลือแค่สองข้อ: `?company=` แล้วก็ `x-company-scope` — ทิ้งข้อ 3-4 ของ middleware เดิม
 * (primaryCompany และ default 'SHOP') ถ้าไม่ได้ระบุมาทั้งสองทาง = **ไม่เขียน** req.entityScope
 *
 * ⚠️ อย่าอ่านข้อนี้ว่า "tax scoping ยังหลับอยู่" — มันตื่นแล้ว: apps/web/src/lib/api.ts:49-52 ยัด
 * `?company=shop|finance` ให้ทุก request ที่ออกจาก workspace ⇒ req.entityScope มีค่าจริงแทบทุก
 * request ของหน้าเว็บแอดมิน ซึ่งต่างจากเดิมที่ EntityScopeMiddleware รันก่อน guard จึง `next()`
 * ทิ้งเสมอและ req.entityScope เป็น undefined 100% มาตั้งแต่ พ.ค. สิ่งที่ยกเว้นข้อ 3 กันไว้จริง ๆ
 * คือ client ที่ไม่ใช่เบราว์เซอร์ (curl / สคริปต์ / LIFF / webhook) ซึ่งไม่ส่งพารามิเตอร์นี้
 *
 * ที่ blast radius ยังเล็กไม่ใช่เพราะ tax หลับ แต่เพราะผู้อ่าน req.entityScope มีแค่สามจุดใน
 * tax.controller.ts (:57 findAll, :73 pp30-preview, :217 generate) และ:
 *   - GET /api/tax (findAll → tax-report.service.ts:120-122 กรองด้วย company.companyCode)
 *     **ไม่มีผู้เรียกในโค้ดเบสนี้เลย** — เว็บ redirect /tax-reports → /finance/vat (App.tsx:1029)
 *   - หน้า VAT (VatReportPage) ซึ่งเป็นผู้เรียก pp30-preview เพียงรายเดียว อยู่ใน zone 'fin'
 *     ของทั้งสาม role ที่ @Roles อนุญาต (menu.ts:430/590/751) ⇒ entityScope = 'FINANCE' เสมอ
 *     ensureTaxTypeAllowedForEntity จึงผ่าน
 * ถ้าจะเพิ่มหน้าที่เรียก GET /api/tax เมื่อไร ต้องเช็คก่อนว่า Company.companyCode
 * (schema.prisma:3410 เป็น String?) ถูกเติมครบแล้ว ไม่งั้นแถวที่ companyCode เป็น NULL จะหาย
 * จากรายการเงียบ ๆ — ดูขั้นตอนนับแถวใน docs/runbooks/2026-09-10-user-companies-backfill-runbook.md
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

  /**
   * `?.` สองตัวข้างล่างเป็นของจำเป็น ห้ามลบ: APP_INTERCEPTOR ถูกเรียกกับ WebSocket context ด้วย
   * (@SubscribeMessage 7 ตัวใน staff-chat.gateway.ts + 2 ตัวใน web-widget.gateway.ts) ซึ่ง
   * switchToHttp().getRequest() คืน Socket ที่ไม่มีทั้ง .query และ .headers — middleware ตัวเดิม
   * ที่ยกตรรกะนี้มาใช้ `req.query.company` แบบไม่มี `?.` ได้เพราะมันเป็น HTTP-only เท่านั้น
   */
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
