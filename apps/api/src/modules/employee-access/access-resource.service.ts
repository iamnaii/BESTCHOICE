import { SHOP_BRAND, SHOP_PHONE_CATEGORIES } from '../../utils/product-readiness.util';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AccessResource, AccessSnapshot, Company, PermissionKey, canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessClient, AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { permissionScopes } from './access-context';
import { domainAccessExecution } from './access-execution-context';
import { productScopeWhere } from './access-query-scope';

export interface ResolvedAccessResources { reference?: 'INSPECTION_TEMPLATE'; emptySelection?: true; company: Company; resources: readonly AccessResource[]; productIds: readonly string[]; }
export type PersistedAccessResolver = (tx: AccessClient, snapshot: AccessSnapshot, lock: boolean) => Promise<ResolvedAccessResources>;
@Injectable()
export class AccessResourceService {
  constructor(private readonly prisma: PrismaService, private readonly snapshots: AccessSnapshotService) {}
  async product(tx: AccessClient, id: string, lock = false): Promise<AccessResource> {
    if (!id || typeof id !== 'string') throw new BadRequestException('กรุณาระบุสินค้า');
    if (lock) {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT b.id FROM branches b JOIN products p ON p.branch_id = b.id WHERE p.id = ${id} FOR SHARE OF b`;
      await tx.$queryRaw`SELECT c.id FROM company_info c WHERE c.id IN (SELECT COALESCE(p.owned_by_company_id, b.company_id) FROM products p JOIN branches b ON b.id = p.branch_id WHERE p.id = ${id}) ORDER BY c.id FOR SHARE`;
    }
    const product = await tx.product.findFirst({ where: { id, deletedAt: null }, include: { ownedBy: true, branch: { include: { company: true } } } });
    if (!product) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงสินค้า');
    const owner = product.ownedByCompanyId ? product.ownedBy : product.branch.company;
    if (!owner || !owner.isActive || owner.deletedAt || !['SHOP', 'FINANCE'].includes(owner.companyCode ?? '') || !product.branch.isActive || product.branch.deletedAt) throw new ForbiddenException('ไม่ทราบบริษัทเจ้าของสินค้า');
    return { company: owner.companyCode as Company, branchId: product.branchId };
  }
  async branch(tx: AccessClient, id: string, lock = false): Promise<AccessResource> {
    if (!id || typeof id !== 'string') throw new BadRequestException('กรุณาระบุสาขา');
    if (lock) {
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${id} FOR SHARE`;
      await tx.$queryRaw`SELECT c.id FROM company_info c JOIN branches b ON b.company_id = c.id WHERE b.id = ${id} FOR SHARE OF c`;
    }
    const branch = await tx.branch.findFirst({ where: { id, isActive: true, deletedAt: null }, include: { company: true } });
    if (!branch?.company?.isActive || branch.company.deletedAt || !['SHOP', 'FINANCE'].includes(branch.company.companyCode ?? '')) throw new ForbiddenException('ไม่ทราบบริษัทของสาขา');
    return { company: branch.company.companyCode as Company, branchId: id };
  }
  assert(snapshot: AccessSnapshot, permission: PermissionKey, resolved: ResolvedAccessResources): void {
    if (resolved.emptySelection) {
      if (resolved.productIds.length || resolved.resources.length || !permissionScopes({ id: snapshot.userId, access: snapshot }, permission, resolved.company).some(t => t.scope !== 'BRANCHES' || t.branchIds.length)) throw new ForbiddenException('ไม่มีขอบเขตรายการ');
      return;
    }
    if (resolved.reference === 'INSPECTION_TEMPLATE') {
      if (permission !== 'inspections.read' || !permissionScopes({ id: snapshot.userId, access: snapshot }, permission, resolved.company).some(t => t.scope !== 'BRANCHES' || t.branchIds.length)) throw new ForbiddenException('ไม่มีสิทธิ์อ่านแม่แบบ');
      return;
    }
    if (!resolved.resources.length || resolved.resources.some(resource => !canAccess(snapshot, permission, resource))) throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการในขอบเขตนี้');
  }
  async preflight(snapshot: AccessSnapshot, permission: PermissionKey, resolver: PersistedAccessResolver) {
    const resolved = await resolver(this.prisma, snapshot, false);
    this.assert(snapshot, permission, resolved);
    return resolved;
  }
  /** Lock order is access-advisory lock, then source rows in sorted ID order.
   * Both managed ordinary employees and persisted owners are reloaded in the transaction.
   * The caller must supply a resolver for all records affected by the domain operation.
   */
  async execute<T>(userId: string, permission: PermissionKey, company: Company, resolver: PersistedAccessResolver | undefined, handler: () => Promise<T>, scopeReads = true): Promise<{ result: T; snapshot: AccessSnapshot; resolved?: ResolvedAccessResources }> {
    return this.prisma.$transaction(async tx => {
      await lockEmployeeAccess(tx);
      const snapshot = await this.snapshots.forUserInTransaction(tx, userId);
      if (!snapshot.managed) throw new ForbiddenException('สิทธิ์เปลี่ยนแปลง กรุณาโหลดใหม่');
      const resolved = resolver ? await resolver(tx, snapshot, true) : undefined;
      if (resolved) this.assert(snapshot, permission, resolved);
      const scope = { userId, company, permission, tuples: permissionScopes({ id: userId, access: snapshot }, permission, company) };
      if (!scope.tuples.length) throw new ForbiddenException('ไม่มีสิทธิ์ในส่วนงานนี้');
      if (resolved?.emptySelection && !scopeReads) throw new ForbiddenException('รายการว่างต้องมีตัวกรองคำค้น');
      const result = await domainAccessExecution.run({ client: tx, snapshot, scope, scopeReads, authorizedProductIds: scopeReads ? resolved?.productIds : undefined }, handler);
      return { result, snapshot, resolved };
    }, { timeout: 30000 });
  }
  async scopedProductIds(tx: AccessClient, snapshot: AccessSnapshot, permission: PermissionKey, company: Company): Promise<string[]> {
    const scope = { userId: snapshot.userId, company, permission, tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company) };
    const rows = await tx.product.findMany({ where: { deletedAt: null, brand: SHOP_BRAND, category: { in: [...SHOP_PHONE_CATEGORIES] }, status: 'IN_STOCK', ...productScopeWhere(scope) }, select: { id: true }, orderBy: { id: 'asc' }, take: 2000 });
    return rows.map(row => row.id);
  }
}
