import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Company, PermissionKey, canAccess } from '@installment/shared';
import { BranchReceivingController } from '../inventory/branch-receiving.controller';
import { StockCountController } from '../inventory/stock-count.controller';
import { ReorderPointsController } from '../inventory/reorder-points.controller';
import { InventoryForecastController } from '../inventory/inventory-forecast.controller';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { inventoryBranchWhere } from './access-inventory-scope';
import { permissionScopes } from './access-context';

export const INVENTORY_BOUNDARY_ROUTES = [
  'BranchReceivingController.findAll', 'BranchReceivingController.findOne', 'BranchReceivingController.getPendingDeliveries', 'BranchReceivingController.receive', 'BranchReceivingController.approvedPurchaseOrders',
  'StockCountController.findAll', 'StockCountController.findOne', 'StockCountController.getVariance', 'StockCountController.create', 'StockCountController.submit', 'StockCountController.cancel',
  'ReorderPointsController.findAll', 'ReorderPointsController.findOne', 'ReorderPointsController.getLowStockDashboard', 'ReorderPointsController.getAlerts', 'ReorderPointsController.getActiveAlerts', 'ReorderPointsController.checkStockLevels', 'ReorderPointsController.resolveAlert', 'ReorderPointsController.create', 'ReorderPointsController.update', 'ReorderPointsController.remove',
  'InventoryForecastController.getForecast',
] as const;
type Route = typeof INVENTORY_BOUNDARY_ROUTES[number];
interface Request { query?: Record<string, string>; params?: Record<string, string>; body?: { branchId?: string; transferId?: string; poId?: string; items?: Array<{ productId: string }> }; }
@Injectable()
export class AccessInventoryBoundaries implements OnModuleInit {
  constructor(private readonly modules: ModuleRef, private readonly resources: AccessResourceService,
    private readonly sources: AccessProcurementSourceService, private readonly sensitive: AccessSensitiveService) {}
  onModuleInit() {
    for (const route of INVENTORY_BOUNDARY_ROUTES) ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
      const company = requestedAccessCompany(req);
      const resolver = this.resolver(route, req, permission, company);
      const collection = ACCESS_POLICIES[route].resolution === 'collection';
      const run = async (handler: () => Promise<unknown>) => (await this.resources.execute(snapshot.userId, permission, company, resolver,
        async () => this.sensitive.projectProductResult(await handler()), true,
        { domain: 'inventory', isolationLevel: 'Serializable', maxAttempts: 3, retryUniqueConflict: route === 'StockCountController.create' })).result;
      if (collection) return { kind: 'collection', company, execute: () => run(() => this.collection(route, req)) };
      if (!resolver) throw new ForbiddenException('ไม่พบตัวตรวจแหล่งที่มา');
      const resolved = await this.resources.preflight(snapshot, permission, resolver);
      if (resolved.emptySelection) return { kind: 'selection', company, execute: run };
      return { kind: 'resource', resource: resolved.resources[0], execute: run };
    });
  }
  private resolver(route: Route, req: Request, permission: PermissionKey, company: Company): PersistedAccessResolver | undefined {
    const method = route.split('.')[1];
    if (method === 'approvedPurchaseOrders') return async (tx, _snapshot, lock) => {
      if (company !== 'SHOP') throw new ForbiddenException('ขั้นตอนรับสินค้าเป็นงาน SHOP');
      const destination = await this.sources.receivingWarehouse(tx);
      if (req.query?.branchId && req.query.branchId !== destination.id) throw new ForbiddenException('ปลายทางไม่ตรงกับคลังรับสินค้า');
      return { company, resources: [await this.resources.branch(tx, destination.id, lock)], productIds: [], receivingBranchId: destination.id };
    };
    if (method === 'create') return async (tx, _snapshot, lock) => {
      const origin = await this.resources.branch(tx, req.body?.branchId ?? '', lock);
      if (origin.company !== company) throw new ForbiddenException('สาขาไม่อยู่ในส่วนงานที่เลือก');
      return { company, resources: [origin], productIds: [] };
    };
    if (method === 'checkStockLevels') return async (tx, snapshot, lock) => {
      const scope = { userId: snapshot.userId, company, permission, tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company) };
      const rows = await tx.reorderPoint.findMany({ where: { AND: [inventoryBranchWhere(scope), { isActive: true }] }, orderBy: { id: 'asc' } });
      if (lock) for (const row of rows) await tx.$queryRaw`SELECT id FROM reorder_points WHERE id = ${row.id} FOR UPDATE`;
      return { company, resources: await Promise.all([...new Set(rows.map(row => row.branchId))].sort().map(id => this.resources.branch(tx, id, lock))), productIds: [], ...(rows.length ? {} : { emptySelection: true as const }) };
    };
    if (route.startsWith('BranchReceivingController.') && ['receive', 'findOne'].includes(method)) return async (tx, snapshot, lock) => {
      let transferId = req.body?.transferId;
      if (method === 'findOne') {
        const receiving = await tx.branchReceiving.findUnique({ where: { id: req.params?.id } });
        if (!receiving || receiving.deletedAt) throw new ForbiddenException('ไม่พบใบรับสินค้า');
        transferId = receiving.transferId;
      }
      if (typeof transferId !== 'string') throw new BadRequestException('กรุณาระบุรายการโอน');
      if (lock) await tx.$queryRaw`SELECT id FROM stock_transfers WHERE id = ${transferId} FOR UPDATE`;
      const transfer = await tx.stockTransfer.findFirst({ where: { id: transferId, deletedAt: null } });
      if (!transfer) throw new ForbiddenException('ไม่พบรายการโอน');
      const product = await this.resources.product(tx, transfer.productId, lock);
      const destination = await this.resources.branch(tx, transfer.toBranchId, lock);
      const source = await this.resources.branch(tx, transfer.fromBranchId, lock);
      if (company !== 'SHOP' || product.company !== 'SHOP' || source.company !== 'SHOP' || destination.company !== company) throw new ForbiddenException('แหล่งสินค้าไม่ตรงส่วนงาน');
      if (method === 'receive' && (!Array.isArray(req.body?.items) || req.body.items.length !== 1 || req.body.items[0].productId !== transfer.productId)) throw new ForbiddenException('สินค้าไม่ตรงรายการโอน');
      const resource = method === 'findOne' ? [source, destination].find(value => canAccess(snapshot, permission, value)) : destination;
      if (!resource) throw new ForbiddenException('ไม่มีสิทธิ์อ่านต้นทางหรือปลายทาง');
      return { company, resources: [resource], productIds: [] };
    };
    if (req.params?.id || req.params?.alertId) return async (tx, snapshot, lock) => {
      const id = req.params!.id ?? req.params!.alertId;
      const count = route.startsWith('StockCountController.');
      const alert = method === 'resolveAlert';
      if (lock) {
        if (count) await tx.$queryRaw`SELECT id FROM stock_counts WHERE id = ${id} FOR UPDATE`;
        else if (alert) await tx.$queryRaw`SELECT id FROM stock_alerts WHERE id = ${id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM reorder_points WHERE id = ${id} FOR UPDATE`;
      }
      const row = count ? await tx.stockCount.findUnique({ where: { id } }) : alert ? await tx.stockAlert.findUnique({ where: { id } }) : await tx.reorderPoint.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new ForbiddenException('ไม่พบรายการ');
      const origin = await this.resources.branch(tx, row.branchId, lock);
      if (origin.company !== company) throw new ForbiddenException('รายการไม่อยู่ในส่วนงานที่เลือก');
      const resources = [origin];
      if (count) {
        const items = await tx.stockCountItem.findMany({ where: { stockCountId: id }, orderBy: { productId: 'asc' } });
        if (method === 'submit' && (!Array.isArray(req.body?.items) || req.body.items.some(item => !items.some(expected => expected.productId === item.productId)) || new Set(req.body.items.map(item => item.productId)).size !== req.body.items.length)) throw new ForbiddenException('สินค้าไม่อยู่ในรายการตรวจนับหรือซ้ำกัน');
        for (const item of items) resources.push(await this.resources.product(tx, item.productId, lock));
      }
      if (alert && req.body?.poId) this.resources.assert(snapshot, 'purchase-orders.read', await this.sources.po(tx, req.body.poId, company, lock));
      return { company, resources, productIds: [] };
    };
    return undefined;
  }
  private async collection(route: Route, req: Request) {
    const q = req.query ?? {};
    if (Object.keys(q).some(key => !['company', 'branchId', 'status', 'page', 'limit', 'category', 'isActive'].includes(key)) || Object.values(q).some(value => typeof value !== 'string')) throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const key of ['page', 'limit']) if (q[key] && (!/^\d+$/.test(q[key]) || +q[key] < 1 || key === 'limit' && +q[key] > 200)) throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    if (q.category && !['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'].includes(q.category)) throw new BadRequestException('ประเภทสินค้าไม่ถูกต้อง');
    if (q.status) {
      const statuses = route.startsWith('StockCount') ? ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] : route.startsWith('BranchReceiving') ? ['PENDING', 'COMPLETED', 'REJECTED', 'PARTIAL_REJECT'] : ['ACTIVE', 'PO_CREATED', 'RESOLVED'];
      if (!statuses.includes(q.status)) throw new BadRequestException('สถานะไม่ถูกต้อง');
    }
    if (q.isActive && !['true', 'false'].includes(q.isActive)) throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    const receiving = () => this.modules.get(BranchReceivingController, { strict: false });
    const count = () => this.modules.get(StockCountController, { strict: false });
    const reorder = () => this.modules.get(ReorderPointsController, { strict: false });
    switch (route) {
      case 'BranchReceivingController.findAll': return receiving().findAll(q.branchId, q.status, q.page, q.limit);
      case 'BranchReceivingController.getPendingDeliveries': return receiving().getPendingDeliveries(q.branchId);
      case 'BranchReceivingController.approvedPurchaseOrders': return receiving().approvedPurchaseOrders(q.branchId, q.page, q.limit);
      case 'StockCountController.findAll': return count().findAll(q.branchId, q.status, q.page, q.limit);
      case 'ReorderPointsController.findAll': return reorder().findAll(q.branchId, q.isActive, q.category, q.page, q.limit);
      case 'ReorderPointsController.getAlerts': return reorder().getAlerts(q.status, q.branchId, q.page, q.limit);
      case 'ReorderPointsController.getActiveAlerts': return reorder().getActiveAlerts(q.branchId, q.page, q.limit);
      case 'ReorderPointsController.getLowStockDashboard': return reorder().getLowStockDashboard(q.branchId, q.page, q.limit);
      case 'InventoryForecastController.getForecast': return this.modules.get(InventoryForecastController, { strict: false }).getForecast(q.branchId);
      default: throw new ForbiddenException('ไม่พบตัวอ่านข้อมูลในขอบเขต');
    }
  }
}
