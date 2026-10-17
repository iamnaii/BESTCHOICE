import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, ValidationPipe } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Company, PermissionKey } from '@installment/shared';
import { POStatus, ReceivingItemStatus } from '@prisma/client';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { ReceivingDocCheckQueryDto } from '../purchase-orders/dto/create-po.dto';
import { SupplierLedgerQueryDto } from '../purchase-orders/dto/supplier-payment.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessProcurementProjectionService } from './access-procurement-projection.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { procurementPreparation } from './access-preparation-context';

export const PROCUREMENT_BOUNDARY_ROUTES = [
  'PurchaseOrdersController.accountsPayable', 'PurchaseOrdersController.approve', 'PurchaseOrdersController.cancel',
  'PurchaseOrdersController.checkReceivingDoc', 'PurchaseOrdersController.create', 'PurchaseOrdersController.directReceive',
  'PurchaseOrdersController.findAll', 'PurchaseOrdersController.findOne', 'PurchaseOrdersController.getGoodsReceivingById',
  'PurchaseOrdersController.getGoodsReceivings', 'PurchaseOrdersController.getQCPending', 'PurchaseOrdersController.getReceivingSummary',
  'PurchaseOrdersController.getSummary', 'PurchaseOrdersController.getSupplierLedger', 'PurchaseOrdersController.getSupplierLedgerMovements',
  'PurchaseOrdersController.goodsReceiving', 'PurchaseOrdersController.listSupplierPayments', 'PurchaseOrdersController.order',
  'PurchaseOrdersController.recordSupplierPayment', 'PurchaseOrdersController.recordTaxInvoice', 'PurchaseOrdersController.reject',
  'PurchaseOrdersController.rejectQC', 'PurchaseOrdersController.update', 'PurchaseOrdersController.updatePayment',
  'PurchaseOrdersController.voidSupplierPayment', 'SuppliersController.create', 'SuppliersController.findAll',
  'SuppliersController.findOne', 'SuppliersController.getPurchaseHistory', 'SuppliersController.markRepairCenter',
  'SuppliersController.remove', 'SuppliersController.update',
] as const;
type Route = typeof PROCUREMENT_BOUNDARY_ROUTES[number];
const validation = new ValidationPipe({ transform: true, whitelist: true });

@Injectable()
export class AccessProcurementBoundaries implements OnModuleInit {
  constructor(private readonly modules: ModuleRef, private readonly resources: AccessResourceService,
    private readonly sources: AccessProcurementSourceService, private readonly projection: AccessProcurementProjectionService) {}
  onModuleInit() {
    for (const route of PROCUREMENT_BOUNDARY_ROUTES) ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
      const company = requestedAccessCompany(req);
      const resolver = this.resolver(route, req, permission, company);
      const collection = ACCESS_POLICIES[route].resolution === 'collection';
      const run = async <T>(handler: () => Promise<T>): Promise<T> => (await this.resources.execute(snapshot.userId, permission, company, resolver,
        async () => this.projection.project(await handler()), collection,
        { domain: 'procurement', isolationLevel: 'Serializable', maxAttempts: 3,
          retryUniqueConflict: route === 'PurchaseOrdersController.goodsReceiving' || route === 'PurchaseOrdersController.directReceive' })).result;
      if (collection) return { kind: 'collection', company, execute: () => run(() => this.collection(route, req)) };
      if (!resolver) throw new ForbiddenException('ไม่พบตัวตรวจแหล่งที่มา');
      const resolved = await this.resources.preflight(snapshot, permission, resolver);
      if (route === 'PurchaseOrdersController.recordTaxInvoice') return {
        kind: 'resource', resource: resolved.resources[0],
        execute: handler => procurementPreparation.run({ execute: run }, handler),
      };
      return { kind: 'resource', resource: resolved.resources[0], execute: run };
    });
  }
  private resolver(route: Route, req: any, permission: PermissionKey, company: Company): PersistedAccessResolver | undefined {
    const method = route.split('.')[1];
    const supplier = route.startsWith('SuppliersController.');
    if (method === 'create' || method === 'directReceive') return async (tx, snapshot, lock) => {
      const origin = await this.sources.origin(tx, company, req.body?.accessBranchId, lock);
      const resolved: Awaited<ReturnType<PersistedAccessResolver>> = { company, resources: [origin], productIds: [] };
      if (!supplier) {
        if (company !== 'SHOP') throw new ForbiddenException('ขั้นตอนจัดซื้อสินค้าเป็นงาน SHOP');
        this.resources.assert(snapshot, 'products.cost.update', resolved);
        const source = await this.sources.supplier(tx, req.body?.supplierId, company, snapshot, 'suppliers.read', lock);
        this.resources.assert(snapshot, 'suppliers.read', source);
        if (method === 'directReceive') {
          if (req.body?.items?.some((item: Record<string, unknown>) => item.sellingPrice !== undefined || item.installmentPrice !== undefined)) this.resources.assert(snapshot, 'pricing.update', resolved);
          if ((req.body?.paidAmount ?? 0) > 0) this.resources.assert(snapshot, 'supplier-payments.create', resolved);
          const warehouse = await this.warehouse(tx);
          resolved.receivingBranchId = warehouse.id;
          const destination = { company, resources: [await this.resources.branch(tx, warehouse.id, lock)], productIds: [] };
          this.resources.assert(snapshot, permission, destination);
          this.resources.assert(snapshot, 'products.cost.update', destination);
          if (req.body?.items?.some((item: Record<string, unknown>) => item.sellingPrice !== undefined || item.installmentPrice !== undefined)) this.resources.assert(snapshot, 'pricing.update', destination);
        }
      }
      return resolved;
    };
    if (supplier && req.params?.id) return (tx, snapshot, lock) => this.sources.supplier(tx, req.params.id, company, snapshot, permission, lock, ['update', 'remove', 'markRepairCenter'].includes(method));
    if (method === 'getSupplierLedgerMovements' || method === 'checkReceivingDoc') return (tx, snapshot, lock) => {
      if (method === 'checkReceivingDoc' && company !== 'SHOP') throw new ForbiddenException('ขั้นตอนรับสินค้าเป็นงาน SHOP');
      return this.sources.supplier(tx, req.params?.supplierId ?? req.query?.supplierId, company, snapshot, permission, lock);
    };
    if (method === 'rejectQC') return async (tx, snapshot, lock) => {
      const ids: unknown = req.body?.productIds;
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new BadRequestException('กรุณาระบุสินค้า');
      const productIds = [...new Set<string>(ids)].sort();
      return { company, productIds, resources: await Promise.all(productIds.map(id => this.resources.product(tx, id, lock))) };
    };
    if (req.params?.id) return async (tx, snapshot, lock) => {
      const resolved = await this.sources.po(tx, req.params.id, company, lock);
      if (req.params.receivingId && !await tx.goodsReceiving.count({ where: { id: req.params.receivingId, poId: req.params.id, deletedAt: null } })) throw new ForbiddenException('ใบรับของไม่อยู่ในใบสั่งซื้อนี้');
      if (req.params.paymentId && !await tx.purchaseOrderPayment.count({ where: { id: req.params.paymentId, poId: req.params.id } })) throw new ForbiddenException('การจ่ายไม่อยู่ในใบสั่งซื้อนี้');
      if (method === 'goodsReceiving') {
        if (company !== 'SHOP') throw new ForbiddenException('ขั้นตอนรับสินค้าเป็นงาน SHOP');
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: req.params.id }, select: { status: true } });
        if (!['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw new ForbiddenException('ใบสั่งซื้อยังไม่พร้อมรับสินค้า');
        // Raw input is checked before whitelist pipes can erase an override.
        if (req.body?.items?.some((item: Record<string, unknown>) => ['costPrice', 'unitPrice', 'receivedCost', 'receivedVat'].some(key => key in item))) throw new ForbiddenException('รับสินค้าตามราคาที่อนุมัติเท่านั้น');
        const warehouse = await this.warehouse(tx);
        // Approved procurement authorizes the source quantities; stock receiving
        // acts at the actual destination, including centrally originated POs.
        // It does not grant PO read/history or caller-directed cost edits.
        resolved.resources = [await this.resources.branch(tx, warehouse.id, lock)];
        resolved.receivingBranchId = warehouse.id;
      }
      if (['update', 'approve', 'order'].includes(method) && (req.body?.items || req.body?.discount !== undefined || req.body?.discountAfterVat !== undefined)) this.resources.assert(snapshot, 'products.cost.update', resolved);
      if (['goodsReceiving', 'directReceive'].includes(method) && req.body?.items?.some((item: Record<string, unknown>) => item.sellingPrice !== undefined || item.installmentPrice !== undefined)) this.resources.assert(snapshot, 'pricing.update', resolved);
      if (['recordSupplierPayment', 'voidSupplierPayment', 'recordTaxInvoice'].includes(method) && company !== 'SHOP') throw new ForbiddenException('รายการบัญชีจัดซื้อเป็นงาน SHOP');
      if (method === 'cancel' && req.body?.depositOutcome) this.resources.assert(snapshot, 'supplier-payments.create', resolved);
      return resolved;
    };
    return undefined;
  }
  private async warehouse(tx: Parameters<PersistedAccessResolver>[0]) {
    const warehouse = await tx.branch.findFirst({ where: { isMainWarehouse: true, isActive: true, deletedAt: null } }) ?? await tx.branch.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!warehouse) throw new ForbiddenException('ไม่พบคลังสินค้า');
    return warehouse;
  }
  private async collection(route: Route, req: any) {
    const query: Record<string, unknown> = req.query ?? {};
    const keys = new Set(['page', 'limit', 'company', 'status', 'supplierId', 'branchId', 'poId', 'includePhotoPending', 'docNumber', 'docDate', 'month', 'startDate', 'endDate', 'search', 'isActive']);
    if (Object.keys(query).some(key => !keys.has(key))) throw new BadRequestException('ไม่รองรับตัวกรองนี้');
    for (const value of Object.values(query)) if (typeof value !== 'string') throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    const q = (key: string): string | undefined => typeof query[key] === 'string' ? query[key] : undefined;
    for (const key of ['page', 'limit']) if (q(key) && (!/^\d+$/.test(q(key)!) || Number(q(key)) < 1 || (key === 'limit' && Number(q(key)) > 200))) throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    for (const key of ['isActive', 'includePhotoPending']) if (q(key) && !['true', 'false'].includes(q(key)!)) throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const key of ['startDate', 'endDate']) if (q(key) && Number.isNaN(Date.parse(q(key)!))) throw new BadRequestException('วันที่ไม่ถูกต้อง');
    const po = () => this.modules.get(PurchaseOrdersController, { strict: false });
    const suppliers = () => this.modules.get(SuppliersController, { strict: false });
    switch (route) {
      case 'PurchaseOrdersController.findAll':
        if (q('status') && !Object.values(POStatus).includes(q('status') as POStatus)) throw new BadRequestException('สถานะไม่ถูกต้อง');
        return po().findAll(q('status'), q('supplierId'), q('page'), q('limit'));
      case 'PurchaseOrdersController.accountsPayable': return po().accountsPayable(q('page'), q('limit'));
      case 'PurchaseOrdersController.getSummary': return po().getSummary();
      case 'PurchaseOrdersController.getQCPending': return po().getQCPending(q('branchId'), q('poId'), q('includePhotoPending'), q('page'), q('limit'));
      case 'PurchaseOrdersController.checkReceivingDoc': return po().checkReceivingDoc(await validation.transform(query, { type: 'query', metatype: ReceivingDocCheckQueryDto }));
      case 'PurchaseOrdersController.getSupplierLedger': return po().getSupplierLedger(await validation.transform(query, { type: 'query', metatype: SupplierLedgerQueryDto }));
      case 'PurchaseOrdersController.getSupplierLedgerMovements': return po().getSupplierLedgerMovements(req.params.supplierId, await validation.transform(query, { type: 'query', metatype: SupplierLedgerQueryDto }));
      case 'PurchaseOrdersController.listSupplierPayments': return po().listSupplierPayments(req.params.id);
      case 'PurchaseOrdersController.getReceivingSummary': return po().getReceivingSummary(req.params.id, q('startDate'), q('endDate'));
      case 'PurchaseOrdersController.getGoodsReceivings':
        if (q('status') && !Object.values(ReceivingItemStatus).includes(q('status') as ReceivingItemStatus)) throw new BadRequestException('สถานะไม่ถูกต้อง');
        return po().getGoodsReceivings(req.params.id, q('status'), q('startDate'), q('endDate'), q('page'), q('limit'), req.user);
      case 'SuppliersController.findAll': return suppliers().findAll(await validation.transform(query, { type: 'query', metatype: PaginationDto }), q('search'), q('isActive'));
      case 'SuppliersController.getPurchaseHistory': return suppliers().getPurchaseHistory(req.params.id, q('page'), q('limit'));
      default: throw new ForbiddenException('ไม่พบตัวอ่านข้อมูลในขอบเขต');
    }
  }
}
