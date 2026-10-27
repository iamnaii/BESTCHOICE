import { ForbiddenException } from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { currentDomainAccess } from './access-execution-context';
import { permissionScopes } from './access-context';

/** Labels/actors do not supply company, branch, or assignment provenance. */
export function importedCompanyAllows(permission: PermissionKey): boolean {
  const ctx = currentDomainAccess();
  return (
    !!ctx &&
    ctx.scope.company === 'SHOP' &&
    permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, permission, 'SHOP').some(
      (tuple) => tuple.userId === ctx.snapshot.userId && tuple.scope === 'COMPANY',
    )
  );
}
export async function assertImportedSource() {
  const ctx = currentDomainAccess();
  if (!ctx || !importedCompanyAllows('imported-sales.read'))
    throw new ForbiddenException('ไม่มีสิทธิ์อ่านประวัติส่วนกลางหน้าร้าน');
  await ctx.client.$queryRaw`SELECT id FROM company_info WHERE company_code = 'SHOP' FOR SHARE`;
  if (
    !(await ctx.client.companyInfo.count({
      where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
    }))
  )
    throw new ForbiddenException('ไม่พบแหล่งประวัติหน้าร้าน');
}
