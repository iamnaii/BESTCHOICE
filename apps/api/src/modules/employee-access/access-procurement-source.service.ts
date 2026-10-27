import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AccessResource,
  AccessSnapshot,
  Company,
  PermissionKey,
  canAccess,
} from '@installment/shared';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService, ResolvedAccessResources } from './access-resource.service';
import { permissionScopes } from './access-context';
import { supplierScopeWhere } from './access-procurement-scope';

@Injectable()
export class AccessProcurementSourceService {
  constructor(private readonly resources: AccessResourceService) {}
  async receivingWarehouse(tx: AccessClient) {
    const warehouse =
      (await tx.branch.findFirst({
        where: { isMainWarehouse: true, isActive: true, deletedAt: null },
      })) ??
      (await tx.branch.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }));
    if (!warehouse) throw new ForbiddenException('ไม่พบคลังสินค้า');
    return warehouse;
  }
  async origin(
    tx: AccessClient,
    company: Company,
    branchId?: string | null,
    lock = false,
  ): Promise<AccessResource> {
    if (lock)
      await tx.$queryRaw`SELECT id FROM company_info WHERE company_code = ${company} FOR SHARE`;
    const entity = await tx.companyInfo.findFirst({
      where: { companyCode: company, isActive: true, deletedAt: null },
    });
    if (!entity) throw new ForbiddenException('ไม่พบส่วนงานที่เปิดใช้งาน');
    if (branchId) {
      const branch = await this.resources.branch(tx, branchId, lock);
      if (company === 'SHOP' && branch.company !== 'SHOP')
        throw new ForbiddenException('สาขาไม่อยู่ในส่วนงานนี้');
    }
    return { company, ...(branchId ? { branchId } : {}) };
  }
  async poEvidence(tx: AccessClient, id: string, lock = false): Promise<ResolvedAccessResources> {
    if (lock) await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        products: { select: { id: true } },
        goodsReceivings: { include: { items: { select: { productId: true } } } },
      },
    });
    if (!po) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงใบสั่งซื้อ');
    if (po.accessCompanyCode) {
      const company = po.accessCompanyCode;
      if (company !== 'SHOP' && company !== 'FINANCE')
        throw new ForbiddenException('ไม่ทราบส่วนงานใบสั่งซื้อ');
      return {
        company,
        resources: [await this.origin(tx, company, po.accessBranchId, lock)],
        productIds: [],
      };
    }
    const productIds = [
      ...new Set([
        ...po.products.map((p) => p.id),
        ...po.goodsReceivings.flatMap((gr) => gr.items.map((i) => i.productId)),
      ]),
    ];
    if (!productIds.length || productIds.some((id) => !id))
      throw new ForbiddenException('ไม่ทราบแหล่งที่มาของใบสั่งซื้อ');
    const ids = productIds.filter((id): id is string => !!id).sort();
    const resources = await Promise.all(ids.map((id) => this.resources.product(tx, id, lock)));
    const company = resources[0].company;
    if (resources.some((r) => r.company !== company))
      throw new ForbiddenException('ใบสั่งซื้อไม่อยู่ในส่วนงานนี้');
    return { company, resources, productIds: ids };
  }
  async po(
    tx: AccessClient,
    id: string,
    company: Company,
    lock = false,
  ): Promise<ResolvedAccessResources> {
    const resolved = await this.poEvidence(tx, id, lock);
    if (resolved.company !== company) throw new ForbiddenException('ใบสั่งซื้อไม่อยู่ในส่วนงานนี้');
    return resolved;
  }
  /** Complete canonical Supplier provenance, independent of caller-visible rows.
   * Shared identity consumers reuse this without inheriting Supplier data access. */
  async supplierSources(
    tx: AccessClient,
    id: string,
    lock = false,
    read = false,
  ): Promise<AccessResource[]> {
    if (lock) await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${id} FOR UPDATE`;
    const supplier = await tx.supplier.findFirst({
      where: { id, deletedAt: null },
      include: {
        products: { where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } },
        purchaseOrders: {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!supplier) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงผู้จัดจำหน่าย');
    const resources: AccessResource[] = [];
    const append = async (resolve: () => Promise<AccessResource[]>) => {
      try {
        resources.push(...(await resolve()));
      } catch (error) {
        if (!read || !(error instanceof ForbiddenException)) throw error;
      }
    };
    if (supplier.accessCompanyCode) {
      const company = supplier.accessCompanyCode;
      if (company !== 'SHOP' && company !== 'FINANCE')
        throw new ForbiddenException('ไม่ทราบส่วนงานเจ้าของผู้จัดจำหน่าย');
      await append(async () => [await this.origin(tx, company, supplier.accessBranchId, lock)]);
    }
    for (const product of supplier.products)
      await append(async () => [await this.resources.product(tx, product.id, lock)]);
    for (const po of supplier.purchaseOrders)
      await append(async () => [...(await this.poEvidence(tx, po.id, lock)).resources]);
    return resources;
  }
  async supplier(
    tx: AccessClient,
    id: string,
    company: Company,
    snapshot: AccessSnapshot,
    permission: PermissionKey,
    lock = false,
    mutation = false,
  ): Promise<ResolvedAccessResources> {
    if (lock) await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${id} FOR UPDATE`;
    const scope = {
      userId: snapshot.userId,
      company,
      permission,
      tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company),
    };
    const supplier = await tx.supplier.findFirst({
      where: { id, ...supplierScopeWhere(scope) },
      include: {
        products: { where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } },
        purchaseOrders: {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!supplier) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงผู้จัดจำหน่าย');
    const resources = await this.supplierSources(tx, id, lock, !mutation);
    if (!mutation)
      return {
        company,
        resources: resources
          .filter((r) => r.company === company && canAccess(snapshot, permission, r))
          .slice(0, 1),
        productIds: [],
      };
    // Party edits affect every linked source, including outside the current scope.
    return { company, resources, productIds: [] };
  }
}
