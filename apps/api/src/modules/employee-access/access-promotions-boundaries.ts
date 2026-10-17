import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PromotionsController } from '../promotions/promotions.controller';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const PROMOTION_DOMAIN_ROUTES = ['findAll', 'findActive', 'findOne', 'applyToSale'].map(
  (m) => `PromotionsController.${m}`,
);
export const PROMOTION_OWNER_ROUTES = ['create', 'update', 'remove'].map(
  (m) => `PromotionsController.${m}`,
);
@Injectable()
export class AccessPromotionsBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly modules: ModuleRef,
  ) {}
  onModuleInit() {
    for (const route of [...PROMOTION_DOMAIN_ROUTES, ...PROMOTION_OWNER_ROUTES])
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const method = route.split('.')[1],
          company = requestedAccessCompany(req);
        if (company !== 'SHOP') throw new ForbiddenException('โปรโมชันอยู่ใน SHOP');
        const run = async (handler: () => Promise<unknown>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                if (
                  !(await ctx.client.companyInfo.count({
                    where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
                  }))
                )
                  throw new ForbiddenException('SHOP ไม่พร้อมใช้งาน');
                if (PROMOTION_OWNER_ROUTES.includes(route) && !ctx.snapshot.isOwner)
                  throw new ForbiddenException('เจ้าของเท่านั้น');
                if (
                  ['findAll', 'findOne', 'findActive'].includes(method) &&
                  !ctx.scope.tuples.some(
                    (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length),
                  )
                )
                  throw new ForbiddenException('ไม่มีขอบเขตอ่านโปรโมชัน');
                const q = req.query ?? {};
                if (
                  Object.keys(q).some(
                    (k) =>
                      ![
                        'company',
                        ...(method === 'findAll' ? ['isActive', 'page', 'limit'] : []),
                      ].includes(k),
                  ) ||
                  Object.values(q).some((v) => typeof v !== 'string')
                )
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                if (q.isActive !== undefined && !['true', 'false'].includes(q.isActive))
                  throw new BadRequestException('สถานะไม่ถูกต้อง');
                for (const key of ['page', 'limit'])
                  if (
                    q[key] !== undefined &&
                    (!/^\d+$/.test(q[key]) ||
                      !Number.isSafeInteger(+q[key]) ||
                      +q[key] < 1 ||
                      (key === 'limit' && +q[key] > 200))
                  )
                    throw new BadRequestException('หน้าไม่ถูกต้อง');
                if ((+(q.page ?? 1) - 1) * +(q.limit ?? 50) > 2147483647)
                  throw new BadRequestException('หน้าไม่ถูกต้อง');
                return handler();
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        if (method === 'findAll' || method === 'findActive')
          return {
            kind: 'collection',
            company,
            execute: () =>
              run(() => {
                const c = this.modules.get(PromotionsController, { strict: false });
                return method === 'findActive'
                  ? c.findActive()
                  : c.findAll(
                      { page: +(req.query?.page ?? 1), limit: +(req.query?.limit ?? 50) },
                      req.query?.isActive,
                    );
              }),
          };
        return { kind: 'selection', company, execute: run };
      });
  }
}
