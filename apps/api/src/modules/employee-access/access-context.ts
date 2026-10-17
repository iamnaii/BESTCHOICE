import { ForbiddenException } from '@nestjs/common';
import { AccessResource, AccessSnapshot, Company, PermissionKey, PERMISSION_CATALOG, isPermissionKey, canAccess, resolveCompanyAccess } from '@installment/shared';

export interface AccessActor { id: string; role?: string; access?: AccessSnapshot; }
export function assertAccess(user: AccessActor, permission: PermissionKey, resource: AccessResource): void {
  if (!user.access || user.access.userId !== user.id || !canAccess(user.access, permission, resource)) {
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
  }
}
/** Original tuples, including ASSIGNED ownership, for building OR predicates BEFORE
 * pagination/count/aggregate. Empty array means deny. Never flatten to branch × permission. */
export function permissionScopes(user: AccessActor, permission: PermissionKey, company: Company) {
  if (!user.access || user.access.userId !== user.id) throw new ForbiddenException('ไม่พบสิทธิ์ปัจจุบัน');
  if (!isPermissionKey(permission)) return [];
  if (!user.access.managed && !user.access.isOwner) return [];
  if (user.access.isOwner) return [{ scope: 'COMPANY' as const, branchIds: [], userId: user.id }];
  if (PERMISSION_CATALOG.find(p => p.key === permission)?.ownerOnly) return [];
  if (permission === 'activity.read') return [{ scope: 'COMPANY' as const, branchIds: [], userId: user.id }];
  return user.access.grants.filter(g => g.company === company && g.permissions.includes(permission))
    .map(g => ({ scope: g.scope, branchIds: [...g.branchIds], userId: user.id }));
}
export function accessCompanies(snapshot: AccessSnapshot, role: string, companies?: string[], primary?: string | null) {
  if (snapshot.managed) {
    const accessibleCompanies: Company[] = snapshot.isOwner ? ['SHOP', 'FINANCE'] : [...new Set(snapshot.grants.map(g => g.company))];
    return { accessibleCompanies, primaryCompany: accessibleCompanies.includes(primary as Company) ? primary : accessibleCompanies[0] ?? null };
  }
  const legacy = resolveCompanyAccess(role, companies, primary);
  return { accessibleCompanies: [...legacy.accessible], primaryCompany: legacy.primary };
}
