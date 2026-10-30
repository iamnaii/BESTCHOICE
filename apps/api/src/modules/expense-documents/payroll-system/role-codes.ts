import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

/**
 * role → รหัสบัญชี อ่านจาก `account_role_map` ผ่าน client ที่ส่งมา (ใน tx ได้) — ไม่ใช้ cache ต่อ instance ของ
 * `AccountRoleService` (prod รันหลาย instance; แก้ role ที่ instance หนึ่งแล้ว instance อื่นยังถือค่าเก่า)
 * การเลือกแถวเหมือน `AccountRoleService.loadCache` ทุกประการ: แถว active เรียง role แล้ว priority น้อยก่อน → แถวแรกของแต่ละ role ชนะ
 */
export async function resolveRoleCodes(client: Prisma.TransactionClient | PrismaService, roles: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(roles)];
  const rows = await client.accountRoleMap.findMany({
    where: { isActive: true, role: { in: wanted } },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }],
    select: { role: true, accountCode: true },
  });
  const byRole = new Map<string, string>();
  for (const r of rows) if (!byRole.has(r.role)) byRole.set(r.role, r.accountCode);
  const missing = wanted.filter((r) => !byRole.has(r));
  if (missing.length > 0) {
    throw new BadRequestException(
      `ไม่พบบัญชีของ role ${missing.join(', ')} ใน account_role_map (หรือถูกปิดใช้งาน) — ` +
        'ให้เจ้าของเพิ่มหรือเปิดใช้งานที่เมนู ตั้งค่าระบบ › ผู้ใช้ & สิทธิ์ › บัญชีตาม บทบาท',
    );
  }
  return Object.fromEntries(byRole);
}
