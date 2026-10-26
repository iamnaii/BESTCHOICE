import { Prisma, ProductStatus, ProductCategory, TransferStatus } from '@prisma/client';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, ValidationPipe } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Company, PermissionKey, canAccess } from '@installment/shared';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver, ResolvedAccessResources } from './access-resource.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { ProductsController } from '../products/products.controller';
import { InspectionsController } from '../quality-control/inspections.controller';
import { ProductPhotosController } from '../quality-control/product-photos.controller';
import { StockListPaginationDto } from '../products/dto/stock-list-pagination.dto';
import { SHOP_BRAND, SHOP_PHONE_CATEGORIES } from '../../utils/product-readiness.util';

/** Explicit reviewed inventory: new methods do not acquire a generic resolver. */
export const SHOP_PRODUCT_BOUNDARY_ROUTES = [
  'InspectionsController.addTemplateItem',
  'InspectionsController.completeInspection',
  'InspectionsController.createInspection',
  'InspectionsController.createTemplate',
  'InspectionsController.deleteTemplate',
  'InspectionsController.deleteTemplateItem',
  'InspectionsController.findAllInspections',
  'InspectionsController.findAllTemplates',
  'InspectionsController.findOneInspection',
  'InspectionsController.findOneTemplate',
  'InspectionsController.overrideGrade',
  'InspectionsController.updateInspection',
  'InspectionsController.updateTemplate',
  'InspectionsController.updateTemplateItem',
  'ProductPhotosController.completePhotos',
  'ProductPhotosController.deletePhoto',
  'ProductPhotosController.getPhotos',
  'ProductPhotosController.uploadPhoto',
  'ProductsController.addPrice',
  'ProductsController.bulkOnlineVisibility',
  'ProductsController.bulkTransfer',
  'ProductsController.confirmTransfer',
  'ProductsController.create',
  'ProductsController.dispatchTransfer',
  'ProductsController.findAccessorySkus',
  'ProductsController.findAll',
  'ProductsController.findOne',
  'ProductsController.getBrands',
  'ProductsController.getInTransitTransfers',
  'ProductsController.getPendingTransfers',
  'ProductsController.getReadiness',
  'ProductsController.getStock',
  'ProductsController.getStockDashboard',
  'ProductsController.getSupplierPerformance',
  'ProductsController.getTransferById',
  'ProductsController.getTransferHistory',
  'ProductsController.getWarrantyExpiring',
  'ProductsController.getWorkflowStatus',
  'ProductsController.promoteListingPhoto',
  'ProductsController.rejectTransfer',
  'ProductsController.remove',
  'ProductsController.removePrice',
  'ProductsController.reserve',
  'ProductsController.returnToStock',
  'ProductsController.transfer',
  'ProductsController.unreserve',
  'ProductsController.update',
  'ProductsController.updateOnlineListing',
  'ProductsController.updatePrice',
] as const;

const validation = new ValidationPipe({ transform: true, whitelist: true });
/** Explicit company selection is a filter, never proof of ownership. */
export function requestedAccessCompany(req: { query?: Record<string, unknown>; headers?: Record<string, unknown> }): Company {
  const value = req.query?.company ?? req.headers?.['x-company-scope'] ?? 'SHOP';
  const company = typeof value === 'string' ? value.toUpperCase() : undefined;
  if (company !== 'SHOP' && company !== 'FINANCE') throw new BadRequestException('ส่วนงานไม่ถูกต้อง');
  return company;
}
function textFilter(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`ตัวกรอง ${key} ไม่ถูกต้อง`);
  return value;
}
@Injectable()
export class AccessShopBoundaries implements OnModuleInit {
  constructor(private readonly modules: ModuleRef, private readonly resources: AccessResourceService, private readonly sensitive: AccessSensitiveService) {}
  onModuleInit() {
    for (const route of SHOP_PRODUCT_BOUNDARY_ROUTES) {
      const policy = ACCESS_POLICIES[route];
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        if (!snapshot.isOwner && !snapshot.grants.some(grant => grant.company === company)) throw new ForbiddenException('ไม่มีสิทธิ์ในส่วนงานนี้');
        const resolver = this.resolver(route, req, permission, company);
        const run = async (handler: () => Promise<unknown>) => {
          const execution = await this.resources.execute(snapshot.userId, permission, company, resolver, async () => {
            // Resolve the current account again inside execution; don't let legacy role
            // redaction hide capabilities or an old role veto the scoped decision.
            if (req.query?.sortBy === 'costPrice' && !await this.sensitive.permitsProductAggregate('sensitive.cost.read', typeof req.query?.branchId === 'string' ? { branchId: req.query.branchId } : {})) throw new ForbiddenException('ไม่มีสิทธิ์เรียงข้อมูลราคาทุน');
            const result = await handler();
            return this.sensitive.projectProductResult(result);
          }, policy.resolution === 'collection' || route === 'ProductsController.bulkOnlineVisibility',
          route === 'ProductsController.findAll' ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxAttempts: 3 } : undefined);
          return execution.result;
        };
        if (policy.resolution === 'collection') {
          return { kind: 'collection', company, execute: () => run(() => this.collection(route, req)) };
        }
        if (!resolver) throw new ForbiddenException('ไม่พบตัวตรวจขอบเขต');
        const resolved = await this.resources.preflight(snapshot, permission, resolver);
        if (resolved.emptySelection) return { kind: 'selection', company, execute: run };
        if (resolved.reference) return { kind: 'reference', company, execute: run };
        return { kind: 'resource', resource: resolved.resources[0], execute: run };
      });
    }
  }
  private resolver(route: string, req: any, permission: PermissionKey, company: Company): PersistedAccessResolver | undefined {
    const method = route.split('.')[1];
    if (route.startsWith('InspectionsController.') && method.toLowerCase().includes('template') && method !== 'findAllTemplates') {
      return async (tx, snapshot, lock) => {
        if (method === 'createTemplate') {
          const entity = await tx.companyInfo.findFirst({ where: { companyCode: company, isActive: true, deletedAt: null } });
          if (!entity) throw new ForbiddenException('ไม่พบส่วนงานที่เปิดใช้งาน');
          return { company, resources: [{ company }], productIds: [] };
        }
        const id = req.params.templateId ?? req.params.id;
        if (lock) await tx.$queryRaw`SELECT id FROM inspection_templates WHERE id = ${id} FOR UPDATE`;
        const template = await tx.inspectionTemplate.findFirst({ where: { id, deletedAt: null }, include: { inspections: { include: { products: { select: { id: true } } } } } });
        if (!template) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงแม่แบบ');
        if (template.accessCompanyCode && template.accessCompanyCode !== company) throw new ForbiddenException('แม่แบบไม่อยู่ในส่วนงานนี้');
        if (method === 'findOneTemplate') return { company, reference: 'INSPECTION_TEMPLATE' as const, resources: [], productIds: [] };
        // Historical shared definitions affect both companies, even before first use.
        // One linked product never grants authority to change a global definition.
        const resources = template.accessCompanyCode ? [{ company }] : [{ company: 'SHOP' as const }, { company: 'FINANCE' as const }];
        return { company, resources, productIds: [] };

      };
    }
    if (ACCESS_POLICIES[route].resolution === 'collection' && method !== 'getPhotos') return undefined;
    return async (tx, snapshot, lock) => {
      const ids: string[] = [];
      const resources: import('@installment/shared').AccessResource[] = [];
      let transfer: { productId: string; fromBranchId: string; toBranchId: string } | null = null;
      if (req.params?.transferId) {
        if (lock) await tx.$queryRaw`SELECT id FROM stock_transfers WHERE id = ${req.params.transferId} FOR UPDATE`;
        transfer = await tx.stockTransfer.findFirst({ where: { id: req.params.transferId, deletedAt: null } });
        if (!transfer) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงรายการโอน');
        ids.push(transfer.productId);
      } else if (route.startsWith('InspectionsController.')) {
        if (method === 'createInspection') {
          ids.push(req.body?.productId);
          const template = await tx.inspectionTemplate.findFirst({ where: { id: req.body?.templateId, deletedAt: null }, include: { inspections: { include: { products: { select: { id: true } } } } } });
          if (!template) throw new ForbiddenException('ไม่พบต้นทางของแม่แบบ');
          if (template.accessCompanyCode && template.accessCompanyCode !== company) throw new ForbiddenException('แม่แบบไม่อยู่ในส่วนงานนี้');
        }
        else {
          if (lock) await tx.$queryRaw`SELECT id FROM inspections WHERE id = ${req.params.id} FOR UPDATE`;
          const inspection = await tx.inspection.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { products: { select: { id: true } } } });
          if (!inspection) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงการตรวจ');
          if (method === 'updateInspection' && Array.isArray(req.body?.results)) {
            for (const result of req.body.results) {
              if (typeof result?.templateItemId !== 'string' || !await tx.inspectionTemplateItem.findFirst({ where: { id: result.templateItemId, templateId: inspection.templateId, deletedAt: null }, select: { id: true } })) throw new ForbiddenException('หัวข้อตรวจไม่ได้อยู่ในแม่แบบของรายการนี้');
            }
          }
          ids.push(inspection.productId, ...inspection.products.map(product => product.id));
        }
      } else if (method === 'bulkTransfer' || method === 'bulkOnlineVisibility') {
        if (method === 'bulkOnlineVisibility' && req.body?.scope === 'ALL_IN_STOCK') {
          const allowed = await this.resources.scopedProductIds(tx, snapshot, permission, company);
          const selected = await tx.product.findMany({ where: { id: { in: allowed }, brand: SHOP_BRAND, category: { in: [...SHOP_PHONE_CATEGORIES] }, status: 'IN_STOCK' }, select: { id: true } });
          ids.push(...selected.map(p => p.id));
          if (!ids.length) return { company, resources: [], productIds: [], emptySelection: true };
        } else {
          if (!Array.isArray(req.body?.productIds) || !req.body.productIds.length || req.body.productIds.some((id: unknown) => typeof id !== 'string')) throw new BadRequestException('กรุณาเลือกสินค้า');
          ids.push(...req.body.productIds);
        }
      } else if (method === 'create') {
        resources.push(await this.resources.branch(tx, req.body?.branchId, lock));
      } else ids.push(req.params?.productId ?? req.params?.id);
      for (const id of [...new Set(ids)].sort()) {
        const product = await this.resources.product(tx, id, lock);
        if (product.company !== company) throw new ForbiddenException('สินค้าไม่อยู่ในส่วนงานที่เลือก');
        if (transfer) {
          // Transfer creates require both endpoints; dispatch belongs to source,
          // receive/reject belongs to destination. Reading may use either endpoint.
          const branchId = ['confirmTransfer', 'rejectTransfer'].includes(method) ? transfer.toBranchId : transfer.fromBranchId;
          if (method === 'getTransferById') {
            const alternatives = [transfer.fromBranchId, transfer.toBranchId].map(branchId => ({ ...product, branchId }));
            const allowed = alternatives.find(resource => canAccess(snapshot, permission, resource));
            if (!allowed) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงรายการโอน');
            resources.push(allowed);
          } else resources.push({ ...product, branchId });
        } else resources.push(product);
      }
      for (const relation of ['poId', 'supplierId'] as const) {
        if (!['create', 'update'].includes(method) || !req.body?.[relation]) continue;
        const linked = await tx.product.findMany({ where: { [relation]: req.body[relation], deletedAt: null }, select: { id: true } });
        if (!linked.length && !snapshot.isOwner) throw new ForbiddenException('ยังไม่พบต้นทางที่ได้รับสิทธิ์ของเอกสารหรือผู้จัดจำหน่าย');
        for (const row of linked) {
          const origin = await this.resources.product(tx, row.id);
          if (!canAccess(snapshot, relation === 'poId' ? 'purchase-orders.read' : 'suppliers.read', origin)) throw new ForbiddenException('ไม่มีสิทธิ์เชื่อมข้อมูลต้นทาง');
        }
      }
      const destination = req.body?.toBranchId ?? (method === 'update' ? req.body?.branchId : undefined);
      if (destination) {
        const branch = await this.resources.branch(tx, destination, lock);
        if (branch.company !== company) throw new ForbiddenException('สาขาไม่อยู่ในส่วนงานเดียวกัน');
        resources.push(branch);
      }
      if (route.startsWith('ProductsController.')) {
        const extra: PermissionKey[] = [];
        if (['create', 'update'].includes(method) && req.body?.costPrice !== undefined) extra.push('products.cost.update');
        if (['addPrice', 'updatePrice', 'removePrice'].includes(method) || ['cashPrice', 'installmentPrice', 'prices'].some(key => req.body?.[key] !== undefined)) extra.push('pricing.update');
        for (const capability of extra) if (resources.some(resource => !canAccess(snapshot, capability, resource))) throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขต้นทุนหรือราคาขาย');
      }
      if (resources.some(resource => resource.company !== company)) throw new ForbiddenException('บริษัทเจ้าของข้อมูลไม่ตรงกับส่วนงาน');
      return { company, resources, productIds: ids } satisfies ResolvedAccessResources;
    };
  }
  private async collection(route: typeof SHOP_PRODUCT_BOUNDARY_ROUTES[number], req: {
    query?: Record<string, unknown>;
    params: Record<string, string>;
    user: Parameters<ProductsController['findAll']>[1];
  }): Promise<unknown> {
    const query = req.query ?? {};
    if (Object.keys(query).some(key => key.includes('[') || key.includes(']'))) throw new BadRequestException('รูปแบบตัวกรองไม่ถูกต้อง');
    for (const key of ['search', 'branchId', 'category', 'brand', 'supplierId', 'model', 'storage', 'deviceOrigin', 'compatibleWithProductId', 'startDate', 'endDate', 'isCompleted', 'productId', 'days']) textFilter(query, key);
    const rawStatus = query.status;
    let status: string | string[] | undefined;
    if (typeof rawStatus === 'string') status = rawStatus;
    else if (Array.isArray(rawStatus) && rawStatus.every((value): value is string => typeof value === 'string')) status = rawStatus;
    else if (rawStatus !== undefined) throw new BadRequestException('สถานะไม่ถูกต้อง');
    if (status !== undefined && status !== '') {
      const statuses = (Array.isArray(status) ? status : [status]).flatMap(value => value.split(',')).map((value: string) => value.trim()).filter(Boolean);
      const allowed: string[] = Object.values(route === 'ProductsController.getTransferHistory' ? TransferStatus : ProductStatus);
      if (statuses.some((status: string) => !allowed.includes(status)) || (route !== 'ProductsController.findAll' && statuses.length !== 1)) throw new BadRequestException('สถานะไม่ถูกต้อง');
    }
    const category = textFilter(query, 'category');
    if (category && !(Object.values(ProductCategory) as string[]).includes(category)) throw new BadRequestException('หมวดหมู่สินค้าไม่ถูกต้อง');
    for (const key of ['startDate', 'endDate']) {
      const date = textFilter(query, key);
      if (date && !Number.isFinite(Date.parse(date))) throw new BadRequestException('วันที่ไม่ถูกต้อง');
    }
    const isCompleted = textFilter(query, 'isCompleted');
    if (isCompleted !== undefined && !['true', 'false'].includes(isCompleted)) throw new BadRequestException('สถานะการตรวจไม่ถูกต้อง');
    const pagination: unknown = await validation.transform(query, { type: 'query', metatype: StockListPaginationDto });
    if (!(pagination instanceof StockListPaginationDto)) throw new BadRequestException('รูปแบบการแบ่งหน้าไม่ถูกต้อง');
    const days = textFilter(query, 'days');
    const products = () => this.modules.get<ProductsController>(ProductsController, { strict: false });
    switch (route) {
      case 'ProductsController.findAll': return products().findAll(pagination, req.user, textFilter(query, 'search'), textFilter(query, 'branchId'), status, textFilter(query, 'category'), textFilter(query, 'brand'), textFilter(query, 'supplierId'), textFilter(query, 'model'), textFilter(query, 'storage'), textFilter(query, 'deviceOrigin'), textFilter(query, 'compatibleWithProductId'));
      case 'ProductsController.getStock': return products().getStock(pagination, req.user, textFilter(query, 'search'), textFilter(query, 'branchId'), textFilter(query, 'status'), textFilter(query, 'category'), textFilter(query, 'brand'));
      case 'ProductsController.getStockDashboard': return products().getStockDashboard(req.user, textFilter(query, 'branchId'));
      case 'ProductsController.getBrands': return products().getBrands();
      case 'ProductsController.findAccessorySkus': return products().findAccessorySkus(req.user, textFilter(query, 'search'), textFilter(query, 'limit'));
      case 'ProductsController.getWarrantyExpiring': {
        if (days !== undefined && (!/^\d+$/.test(days) || Number(days) > 3650)) throw new BadRequestException('จำนวนวันไม่ถูกต้อง');
        return products().getWarrantyExpiring(days, textFilter(query, 'branchId'));
      }
      case 'ProductsController.getSupplierPerformance': return products().getSupplierPerformance();
      case 'ProductsController.getPendingTransfers': return products().getPendingTransfers(textFilter(query, 'branchId'));
      case 'ProductsController.getInTransitTransfers': return products().getInTransitTransfers(textFilter(query, 'branchId'));
      case 'ProductsController.getTransferHistory': return products().getTransferHistory(pagination, textFilter(query, 'branchId'), textFilter(query, 'status'), textFilter(query, 'startDate'), textFilter(query, 'endDate'));
      case 'InspectionsController.findAllInspections': return this.modules.get<InspectionsController>(InspectionsController, { strict: false }).findAllInspections(isCompleted, textFilter(query, 'productId'));
      case 'InspectionsController.findAllTemplates': return this.modules.get<InspectionsController>(InspectionsController, { strict: false }).findAllTemplates();
      case 'ProductPhotosController.getPhotos': return this.modules.get<ProductPhotosController>(ProductPhotosController, { strict: false }).getPhotos(req.params.productId);
      default: throw new ForbiddenException('ไม่มีตัวดำเนินการที่กำหนดขอบเขต');
    }
  }
}
