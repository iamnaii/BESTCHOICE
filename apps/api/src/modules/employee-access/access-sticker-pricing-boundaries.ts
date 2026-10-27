import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AccessSnapshot, Company, PermissionKey, canAccess } from '@installment/shared';
import { StickersController } from '../stickers/stickers.controller';
import { PricingTemplatesController } from '../pricing-templates/pricing-templates.controller';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { permissionScopes } from './access-context';
import { stickerProductWhere } from './access-sticker-pricing-scope';
import { safeReferenceError } from './access-shared-reference';

export const STICKER_PRICING_ROUTES = [
  'StickersController.findAll',
  'StickersController.findOne',
  'StickersController.create',
  'StickersController.update',
  'StickersController.remove',
  'StickersController.getStickerData',
  'StickersController.getStickerDataBatch',
  'PricingTemplatesController.findAll',
  'PricingTemplatesController.lookup',
  'PricingTemplatesController.findOne',
  'PricingTemplatesController.create',
  'PricingTemplatesController.update',
  'PricingTemplatesController.remove',
  'PricingTemplatesController.bulkImport',
] as const;
function entry(snapshot: AccessSnapshot, key: PermissionKey, company: Company) {
  return permissionScopes({ id: snapshot.userId, access: snapshot }, key, company).some(
    (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length > 0),
  );
}
@Injectable()
export class AccessStickerPricingBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly modules: ModuleRef,
  ) {}
  onModuleInit() {
    for (const route of STICKER_PRICING_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        const method = route.split('.')[1];
        const output = method === 'getStickerData' || method === 'getStickerDataBatch';
        const mutation = ['create', 'update', 'remove', 'bulkImport'].includes(method);
        const run = async (handler: () => Promise<unknown>) => {
          try {
            return (
              await this.resources.execute(
                snapshot.userId,
                permission,
                company,
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!;
                  if (!entry(ctx.snapshot, permission, company))
                    throw new ForbiddenException('ไม่มีสิทธิ์ในส่วนงานนี้');
                  if (
                    !(await ctx.client.companyInfo.findFirst({
                      where: { companyCode: company, isActive: true, deletedAt: null },
                    }))
                  )
                    throw new ForbiddenException('ส่วนงานไม่พร้อมใช้งาน');
                  if (mutation) {
                    for (const affected of ['SHOP', 'FINANCE'] as const) {
                      if (!canAccess(ctx.snapshot, permission, { company: affected }))
                        throw new ForbiddenException('ต้องมีสิทธิ์ทั้งสองส่วนงาน');
                      if (
                        !(await ctx.client.companyInfo.findFirst({
                          where: { companyCode: affected, isActive: true, deletedAt: null },
                        }))
                      )
                        throw new ForbiddenException('ส่วนงานไม่พร้อมใช้งาน');
                    }
                  }
                  if (output) {
                    if (!entry(ctx.snapshot, 'products.read', company))
                      throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้า');
                    const raw =
                      method === 'getStickerData' ? req.params?.productId : req.query?.ids;
                    if (raw !== undefined && typeof raw !== 'string')
                      throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
                    // Match the canonical consumer: a path parameter is one key,
                    // including commas inside a serial; only the batch query is CSV.
                    const keys = (
                      method === 'getStickerData' ? [raw ?? ''] : (raw ?? '').split(',')
                    )
                      .map((s: string) => s.trim())
                      .filter(Boolean);
                    if (keys.length > 100)
                      throw new BadRequestException('จำนวนสินค้าต้องไม่เกิน 100 รายการต่อครั้ง');
                    const rows = await ctx.client.product.findMany({
                      where: {
                        deletedAt: null,
                        AND: [stickerProductWhere()],
                        OR: [{ id: { in: keys } }, { imeiSerial: { in: keys } }],
                      },
                      select: { id: true },
                      orderBy: { id: 'asc' },
                    });
                    for (const row of rows) {
                      const source = await this.resources.product(ctx.client, row.id, true);
                      if (
                        source.company !== company ||
                        !canAccess(ctx.snapshot, permission, source) ||
                        !canAccess(ctx.snapshot, 'products.read', source)
                      )
                        throw new ForbiddenException('สิทธิ์สินค้าเปลี่ยนแปลง');
                    }
                  }
                  const result = await handler();
                  if (output || mutation) {
                    const value = result as { id?: string; success?: number; skipped?: number };
                    const ids = output
                      ? (Array.isArray(result) ? result : [result]).map(
                          (r: { productId: string }) => r.productId,
                        )
                      : value.id
                        ? [value.id]
                        : [];
                    await ctx.client.auditLog.create({
                      data: {
                        userId: ctx.snapshot.userId,
                        action: output
                          ? 'STICKER_DATA_GENERATED'
                          : method === 'bulkImport'
                            ? value.skipped
                              ? 'SHARED_REFERENCE_IMPORT_REJECTED'
                              : 'SHARED_REFERENCE_IMPORT_COMPLETED'
                            : 'SHARED_REFERENCE_CHANGED',
                        entity: output
                          ? 'product'
                          : route.startsWith('Stickers')
                            ? 'sticker_template'
                            : 'pricing_template',
                        entityId: value.id ?? 'batch',
                        newValue: {
                          route,
                          company,
                          ids,
                          ...(output
                            ? {
                                generation: 'GENERATED',
                                delivery: 'NOT_OBSERVED',
                                paperPrinted: false,
                                count: ids.length,
                              }
                            : {
                                operation: method,
                                ...(method === 'bulkImport'
                                  ? { success: value.success ?? 0, skipped: value.skipped ?? 0 }
                                  : {}),
                              }),
                        },
                      },
                    });
                    if (mutation && method !== 'bulkImport') return { id: value.id };
                  }
                  return result;
                },
                false,
                { isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result;
          } catch (error) {
            throw safeReferenceError(error);
          }
        };
        if (ACCESS_POLICIES[route].resolution === 'collection')
          return {
            kind: 'collection',
            company,
            execute: () =>
              run(async () => {
                const q = req.query ?? {};
                const allowed = route.startsWith('Stickers')
                  ? output
                    ? ['company', 'ids']
                    : ['company', 'page', 'limit']
                  : method === 'lookup'
                    ? [
                        'company',
                        'brand',
                        'model',
                        'storage',
                        'category',
                        'hasWarranty',
                        'deviceOrigin',
                      ]
                    : ['company', 'brand', 'category', 'deviceOrigin'];
                if (Object.keys(q).some((key) => !allowed.includes(key)))
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                if (
                  q.category &&
                  !['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'].includes(q.category)
                )
                  throw new BadRequestException('ประเภทสินค้าไม่ถูกต้อง');
                if (
                  method === 'lookup' &&
                  (!q.brand ||
                    !q.model ||
                    (q.hasWarranty && !['true', 'false'].includes(q.hasWarranty)))
                )
                  throw new BadRequestException('ข้อมูลค้นหาราคาไม่ถูกต้อง');
                if (Object.values(q).some((v) => typeof v !== 'string'))
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                if (route === 'StickersController.findAll') {
                  for (const key of ['page', 'limit'])
                    if (q[key] && (!/^\d+$/.test(q[key]) || +q[key] < 1))
                      throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
                  return this.modules
                    .get(StickersController, { strict: false })
                    .findAll(q.page, q.limit);
                }
                if (output)
                  return this.modules
                    .get(StickersController, { strict: false })
                    .getStickerDataBatch(q.ids);
                const controller = this.modules.get(PricingTemplatesController, { strict: false });
                if (method === 'lookup')
                  return controller.lookup(
                    q.brand,
                    q.model,
                    q.storage,
                    q.category,
                    q.hasWarranty,
                    q.deviceOrigin,
                  );
                return controller.findAll(q.brand, q.category, q.deviceOrigin);
              }),
          };
        return { kind: 'reference', company, execute: run };
      });
  }
}
