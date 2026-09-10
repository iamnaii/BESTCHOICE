import { SetMetadata } from '@nestjs/common';

export const ENTITY_KEY = 'entity_scope';

export type EntityType = 'SHOP' | 'FINANCE';

/**
 * SP7.1 — Mark a handler as requiring access to a specific company.
 *
 *   @UseGuards(JwtAuthGuard, EntityScopeGuard)
 *   @Entity('FINANCE')
 *   @Get('contracts')
 *   getContracts(@Req() req) {...}
 *
 * กฎที่ EntityScopeGuard บังคับจริง (แก้ 2026-09-10 — ข้อความเดิมบรรยายบั๊ก ไม่ใช่ contract):
 *   accessibleCompanies ว่าง/ไม่มี = "ยังไม่ตั้งค่า" → resolve เป็นค่า default ของ role
 *     ผ่าน hasCompanyAccess (packages/shared/src/company-access.ts) **ไม่ใช่ 403**
 *     การ 403 ใส่ array ว่างคือเหตุที่ 10 route ของ trade-in ตายเงียบมาตั้งแต่ พ.ค. — ห้ามคืนกลับมา
 *   accessibleCompanies ไม่ว่างแต่ไม่มีบริษัทที่ handler ต้องการ → 403
 *   token ฝั่งลูกค้าหน้าร้าน (aud='shop' / role='CUSTOMER') → 403 เสมอ
 *
 * @Entity() ไม่ได้เขียน req.entityScope ให้ — ตัวเขียนคือ EntityScopeInterceptor และมันเขียน
 * เฉพาะเมื่อ request ระบุ ?company= / x-company-scope มาเท่านั้น ⇒ ใน handler นี้
 * `req.entityScope` เป็น undefined ได้ (เช่น curl / สคริปต์ที่ไม่ส่งพารามิเตอร์)
 * ห้ามเขียนเงื่อนไขที่ถือว่ามันมีค่าเสมอ
 */
export const Entity = (scope: EntityType) => SetMetadata(ENTITY_KEY, scope);
