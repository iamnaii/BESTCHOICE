import { SHOP_BRAND, SHOP_PHONE_CATEGORIES } from '../../utils/product-readiness.util';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessResource, AccessSnapshot, Company, PermissionKey, canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessClient, AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { permissionScopes } from './access-context';
import { domainAccessExecution } from './access-execution-context';
import { productScopeWhere } from './access-query-scope';
import { Prisma } from '@prisma/client';

export interface AccessExecutionOptions {
  domain?: 'procurement' | 'inventory' | 'adjustments' | 'trade-in' | 'parties';
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Whole-attempt retries, including fresh authorization and source resolution. */
  maxAttempts?: 1 | 2 | 3;
  retryUniqueConflict?: boolean;
  /** Internal bounded override for the owned Customer export snapshot only. */
  timeoutMs?: 30000 | 60000;
}
function retryable(error: unknown, unique: boolean): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2034' || (unique && error.code === 'P2002') ||
    (error.code === 'P2010' && (error.meta?.code === '40001' || error.meta?.code === '40P01'));
}

export interface ResolvedAccessResources { reference?: 'INSPECTION_TEMPLATE' | 'TRADE_IN_REFERENCE'; emptySelection?: true; company: Company; resources: readonly AccessResource[]; productIds: readonly string[]; receivingBranchId?: string; }
export type PersistedAccessResolver = (tx: AccessClient, snapshot: AccessSnapshot, lock: boolean) => Promise<ResolvedAccessResources>;
@Injectable()
export class AccessResourceService {
  private readonly logger = new Logger(AccessResourceService.name);
  constructor(private readonly prisma: PrismaService, private readonly snapshots: AccessSnapshotService) {}
  async product(tx: AccessClient, id: string, lock = false): Promise<AccessResource> {
    return this.resolveProduct(tx, id, lock, false);
  }
  /** Narrow recovery/evidence resolver; ordinary product access remains live-only. */
  async adjustmentProduct(tx: AccessClient, id: string, lock = false): Promise<AccessResource> {
    return this.resolveProduct(tx, id, lock, true);
  }
  private async resolveProduct(tx: AccessClient, id: string, lock: boolean, recovery: boolean): Promise<AccessResource> {
    if (!id || typeof id !== 'string') throw new BadRequestException('กรุณาระบุสินค้า');
    if (lock) {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT b.id FROM branches b JOIN products p ON p.branch_id = b.id WHERE p.id = ${id} FOR SHARE OF b`;
      await tx.$queryRaw`SELECT c.id FROM company_info c WHERE c.id IN (SELECT COALESCE(p.owned_by_company_id, b.company_id) FROM products p JOIN branches b ON b.id = p.branch_id WHERE p.id = ${id}) ORDER BY c.id FOR SHARE`;
    }
    const product = await tx.product.findFirst({ where: { id, ...(recovery ? {} : { deletedAt: null }) }, include: { ownedBy: true, branch: { include: { company: true } } } });
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
    if (resolved.reference === 'TRADE_IN_REFERENCE') {
      if (permission !== 'trade-in.read' || !permissionScopes({ id: snapshot.userId, access: snapshot }, permission, 'SHOP').some(t => t.scope === 'COMPANY' || t.scope === 'BRANCHES' && t.branchIds.length)) throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลอ้างอิง');
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
  async execute<T>(userId: string, permission: PermissionKey, company: Company, resolver: PersistedAccessResolver | undefined, handler: () => Promise<T>, scopeReads = true, options: AccessExecutionOptions = {}): Promise<{ result: T; snapshot: AccessSnapshot; resolved?: ResolvedAccessResources; effectFailures: number }> {
    const isolationLevel = options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted;
    for (let attempt = 1; ; attempt++) {
      const effects = { commit: [] as Array<() => Promise<void>>, rollback: [] as Array<() => Promise<void>> };
      let completed: { result: T; snapshot: AccessSnapshot; resolved?: ResolvedAccessResources };
      try {
        completed = await this.prisma.$transaction(async tx => {
      await lockEmployeeAccess(tx);
      // Serializable may have established its snapshot before waiting for the
      // advisory lock. Lock all authority dependencies BEFORE reading them:
      // PostgreSQL aborts stale row versions rather than accepting revoked rights.
      if (isolationLevel !== 'ReadCommitted') {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
        // Assignment versions are soft-retired; their branch junctions are immutable.
        // Lock retirement itself, even when no user revision changed.
        await tx.$queryRaw`SELECT id FROM employee_access_assignments WHERE user_id = ${userId} ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM access_positions WHERE id IN (SELECT position_id FROM employee_access_assignments WHERE user_id = ${userId}) ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM branches WHERE id IN (SELECT branch_id FROM employee_access_assignment_branches WHERE assignment_id IN (SELECT id FROM employee_access_assignments WHERE user_id = ${userId})) ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM company_info WHERE company_code IN ('SHOP', 'FINANCE') ORDER BY id FOR SHARE`;
      }
      const snapshot = await this.snapshots.forUserInTransaction(tx, userId);
      if (!snapshot.managed) throw new ForbiddenException('สิทธิ์เปลี่ยนแปลง กรุณาโหลดใหม่');
      const resolved = resolver ? await resolver(tx, snapshot, true) : undefined;
      if (resolved) this.assert(snapshot, permission, resolved);
      const scope = { userId, company, permission, tuples: permissionScopes({ id: userId, access: snapshot }, permission, company) };
      if (!scope.tuples.length) throw new ForbiddenException('ไม่มีสิทธิ์ในส่วนงานนี้');
      if (resolved?.emptySelection && !scopeReads) throw new ForbiddenException('รายการว่างต้องมีตัวกรองคำค้น');
      const result = await domainAccessExecution.run({ client: tx, snapshot, scope, scopeReads, domain: options.domain, receivingBranchId: resolved?.receivingBranchId, isolationLevel, effects, authorizedProductIds: scopeReads && !options.domain ? resolved?.productIds : undefined }, handler);
      return { result, snapshot, resolved };
        }, { timeout: options.timeoutMs ?? 30000, isolationLevel });
      } catch (error) {
        // Cleanup failure must not trigger a retry which could duplicate a file.
        await Promise.all(effects.rollback.map(cleanup => cleanup()));
        if (attempt < (options.maxAttempts ?? 1) && retryable(error, options.retryUniqueConflict ?? false)) continue;
        throw error;
      }
      // Outside transaction, retry loop's catch and AsyncLocalStorage. A failed
      // notification can never restart a committed financial operation.
      let effectFailures = 0;
      for (const effect of effects.commit) {
        try { await effect(); } catch {
          effectFailures++;
          this.logger.error('Committed domain mutation: post-commit effect failed; mutation was not retried');
        }
      }
      return { ...completed, effectFailures };
    }
  }
  async scopedProductIds(tx: AccessClient, snapshot: AccessSnapshot, permission: PermissionKey, company: Company): Promise<string[]> {
    const scope = { userId: snapshot.userId, company, permission, tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company) };
    const rows = await tx.product.findMany({ where: { deletedAt: null, brand: SHOP_BRAND, category: { in: [...SHOP_PHONE_CATEGORIES] }, status: 'IN_STOCK', ...productScopeWhere(scope) }, select: { id: true }, orderBy: { id: 'asc' }, take: 2000 });
    return rows.map(row => row.id);
  }
}
