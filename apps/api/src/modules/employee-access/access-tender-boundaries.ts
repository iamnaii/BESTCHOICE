import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShopTendersController } from '../shop-tenders/shop-tenders.controller';
import { ImportedSalesService } from '../imported-sales/imported-sales.service';
import { QueryImportedSalesDto } from '../imported-sales/dto/query-imported-sales.dto';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { TenderSourcePlan, tenderAccess } from './access-tender-source';
import { projectTenderRead } from './access-tender-projection';
import { assertImportedSource } from './access-imported-source';

export const TENDER_READ_METHODS = [
  'getDailySummary',
  'getCashCloseStatus',
  'getCashCloseHistory',
  'getCashCloseOverview',
  'getCashCloseReminder',
] as const;
@Injectable()
export class AccessTenderBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly modules: ModuleRef,
  ) {}
  onModuleInit() {
    for (const method of TENDER_READ_METHODS)
      ACCESS_BOUNDARIES.set(
        `ShopTendersController.${method}`,
        async (req, snapshot, permission) => {
          const company = requestedAccessCompany(req);
          if (company !== 'SHOP') throw new ForbiddenException('ข้อมูลนี้เป็นเงินหน้าร้าน');
          return {
            kind: 'collection',
            company,
            execute: async () =>
              (
                await this.resources.execute(
                  snapshot.userId,
                  permission,
                  company,
                  undefined,
                  async () => {
                    const ctx = currentDomainAccess()!;
                    const query = req.query ?? {};
                    for (const key of ['branchId', 'date', 'month'])
                      if (query[key] !== undefined && typeof query[key] !== 'string')
                        throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                    const branchId = query.branchId || undefined;
                    if (query.date && !/^\d{4}-\d{2}-\d{2}$/.test(query.date))
                      throw new BadRequestException('วันที่ไม่ถูกต้อง');
                    if (query.month && !/^\d{4}-\d{2}$/.test(query.month))
                      throw new BadRequestException('เดือนไม่ถูกต้อง');
                    const plan = await TenderSourcePlan.create(ctx.client, branchId);
                    const actor = await ctx.client.user.findUniqueOrThrow({
                      where: { id: ctx.snapshot.userId },
                      select: { id: true, role: true, branchId: true },
                    });
                    req.user = { ...req.user, ...actor, access: ctx.snapshot };
                    const controller = this.modules.get(ShopTendersController, { strict: false });
                    return tenderAccess.run(plan, async () => {
                      const result =
                        method === 'getDailySummary'
                          ? await controller.getDailySummary(req.user, query.date, branchId)
                          : method === 'getCashCloseStatus'
                            ? await controller.getCashCloseStatus(req.user, branchId, query.date)
                            : method === 'getCashCloseHistory'
                              ? await controller.getCashCloseHistory(
                                  req.user,
                                  branchId,
                                  query.month,
                                )
                              : method === 'getCashCloseOverview'
                                ? await controller.getCashCloseOverview(
                                    req.user,
                                    query.date,
                                    branchId,
                                  )
                                : await controller.getCashCloseReminder(req.user, branchId);
                      return projectTenderRead(plan, method, result);
                    });
                  },
                  false,
                  { isolationLevel: 'Serializable', maxAttempts: 3 },
                )
              ).result,
          };
        },
      );
    for (const method of ['list', 'summary'] as const)
      ACCESS_BOUNDARIES.set(
        `ImportedSalesController.${method}`,
        async (req, snapshot, permission) => {
          const company = requestedAccessCompany(req);
          return {
            kind: 'collection',
            company,
            execute: async () =>
              (
                await this.resources.execute(
                  snapshot.userId,
                  permission,
                  company,
                  undefined,
                  async () => {
                    await assertImportedSource();
                    const dto = plainToInstance(QueryImportedSalesDto, req.query ?? {});
                    if ((await validate(dto, { whitelist: true })).length)
                      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                    return this.modules.get(ImportedSalesService, { strict: false })[method](dto);
                  },
                  false,
                  { isolationLevel: 'Serializable', maxAttempts: 3 },
                )
              ).result,
          };
        },
      );
  }
}
