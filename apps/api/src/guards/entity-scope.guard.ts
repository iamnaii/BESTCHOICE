import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasCompanyAccess } from '@installment/shared';
import { ENTITY_KEY, EntityType } from '../decorators/entity.decorator';

/**
 * SP7.1 — อ่าน metadata ของ @Entity(...) แล้วปฏิเสธ request ที่ user ไม่มีสิทธิ์ในบริษัทนั้น
 *
 * ไม่มี @Entity → ผ่าน (handler ไม่ผูกกับบริษัท)
 * accessibleCompanies ว่าง → **ไม่ใช่ 403** แต่แปลว่า "ยังไม่ backfill" → resolve เป็นค่า default
 *   ของ role ผ่าน hasCompanyAccess (packages/shared/src/company-access.ts) การ 403 ใส่ array ว่าง
 *   คือบั๊กเดิมที่ทำให้ 10 route ของ trade-in ตายเงียบมาตั้งแต่ พ.ค. — ห้ามคืนกลับมา
 * accessibleCompanies ไม่ว่าง → บังคับตามนั้นเป๊ะ แม้ role default จะกว้างกว่าก็ตาม
 */
@Injectable()
export class EntityScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<EntityType>(ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // ห้ามเอา @Entity ไปติดระดับ class ที่มี @Public route ปนอยู่ — route นั้นจะไม่มี req.user
    // แล้วโดน 403 ด้านล่างทันที ให้ติดระดับ method เท่านั้น
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { role?: string; accessibleCompanies?: string[] } | undefined;

    // route ที่ติด @Entity ต้องผ่าน JwtAuthGuard มาก่อนเสมอ ไม่มี user = ผิดปกติ
    if (!user) {
      throw new ForbiddenException(`Handler ต้องการสิทธิ์ company ${required}; ไม่พบผู้ใช้ในคำขอ`);
    }

    if (!hasCompanyAccess(user.role ?? '', user.accessibleCompanies, required)) {
      throw new ForbiddenException(
        `Handler ต้องการสิทธิ์ company ${required}; user สิทธิ์: ${
          user.accessibleCompanies?.join(',') || '(none)'
        }`,
      );
    }

    return true;
  }
}
