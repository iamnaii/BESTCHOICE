import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessResource, AccessSnapshot, Company, PermissionKey, canAccess } from '@installment/shared';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService, ResolvedAccessResources } from './access-resource.service';
import { permissionScopes } from './access-context';
import { purchaseOrderScopeWhere, supplierScopeWhere } from './access-procurement-scope';

@Injectable()
export class AccessProcurementSourceService {
  constructor(private readonly resources: AccessResourceService) {}
  async origin(tx: AccessClient, company: Company, branchId?: string | null, lock = false): Promise<AccessResource> {
    if (lock) await tx.$queryRaw`SELECT id FROM company_info WHERE company_code = ${company} FOR SHARE`;
    const entity = await tx.companyInfo.findFirst({ where: { companyCode: company, isActive: true, deletedAt: null } });
    if (!entity) throw new ForbiddenException('ไม่พบส่วนงานที่เปิดใช้งาน');
    if (branchId) {
      const branch = await this.resources.branch(tx, branchId, lock);
      if (company === 'SHOP' && branch.company !== 'SHOP') throw new ForbiddenException('สาขาไม่อยู่ในส่วนงานนี้');
    }
    return { company, ...(branchId ? { branchId } : {}) };
  }
  async po(tx: AccessClient, id: string, company: Company, lock = false): Promise<ResolvedAccessResources> {
    if (lock) await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const po = await tx.purchaseOrder.findFirst({ where: { id, deletedAt: null }, include: { products: { select: { id: true } }, goodsReceivings: { include: { items: { select: { productId: true } } } } } });
    if (!po) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงใบสั่งซื้อ');
    if (po.accessCompanyCode) {
      if (po.accessCompanyCode !== company) throw new ForbiddenException('ใบสั่งซื้อไม่อยู่ในส่วนงานนี้');
      return { company, resources: [await this.origin(tx, company, po.accessBranchId, lock)], productIds: [] };
    }
    const productIds = [...new Set([...po.products.map(p => p.id), ...po.goodsReceivings.flatMap(gr => gr.items.map(i => i.productId))])];
    if (!productIds.length || productIds.some(id => !id)) throw new ForbiddenException('ไม่ทราบแหล่งที่มาของใบสั่งซื้อ');
    const ids = productIds.filter((id): id is string => !!id).sort();
    const resources = await Promise.all(ids.map(id => this.resources.product(tx, id, lock)));
    if (resources.some(r => r.company !== company)) throw new ForbiddenException('ใบสั่งซื้อไม่อยู่ในส่วนงานนี้');
    return { company, resources, productIds: ids };
  }
  async supplier(tx: AccessClient, id: string, company: Company, snapshot: AccessSnapshot, permission: PermissionKey, lock = false, mutation = false): Promise<ResolvedAccessResources> {
    if (lock) await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${id} FOR UPDATE`;
    const scope = { userId: snapshot.userId, company, permission, tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company) };
    const supplier = await tx.supplier.findFirst({ where: { id, ...supplierScopeWhere(scope) }, include: { products: { where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } }, purchaseOrders: { where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } } } });
    if (!supplier) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงผู้จัดจำหน่าย');
    const resources: AccessResource[] = [];
    if (supplier.accessCompanyCode === company) resources.push(await this.origin(tx, company, supplier.accessBranchId, lock));
    for (const product of supplier.products) {
      const resource = await this.resources.product(tx, product.id, lock);
      if (mutation || (resource.company === company && canAccess(snapshot, permission, resource))) resources.push(resource);
    }
    for (const po of supplier.purchaseOrders) {
      if (!mutation && !await tx.purchaseOrder.count({ where: { id: po.id, ...purchaseOrderScopeWhere(scope) } })) continue;
      resources.push(...(await this.po(tx, po.id, company, lock)).resources);
    }
    if (!mutation) return { company, resources: resources.filter(r => r.company === company && canAccess(snapshot, permission, r)).slice(0, 1), productIds: [] };
    // Party edits affect every linked source, including outside the current scope.
    return { company, resources, productIds: [] };
  }
}
