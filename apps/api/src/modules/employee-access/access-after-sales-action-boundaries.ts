import { MAX_INTAKE_PHOTOS } from '../after-sales/services/after-sales-case.service';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { afterSalesSource } from './access-after-sales-source.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { procurementPreparation } from './access-preparation-context';

export const AFTER_SALES_ACTION_ROUTES = [
  'send',
  'markRepaired',
  'sendBack',
  'ret',
  'cancel',
  'addPhoto',
].map((method) => `AfterSalesController.${method}`);
@Injectable()
export class AccessAfterSalesActionBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const route of AFTER_SALES_ACTION_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('งานหลังการขายอยู่ใน SHOP');
        const resolver: PersistedAccessResolver = async (tx, current, lock) => {
          const result = {
            company: 'SHOP' as const,
            resources: [await afterSalesSource(tx, req.params.id, lock)],
            productIds: [],
          };
          this.resources.assert(current, permission, result);
          if (route.endsWith('.addPhoto')) {
            const row = await tx.afterSalesCase.findUniqueOrThrow({
              where: { id: req.params.id },
              select: { photoKeys: true },
            });
            if (row.photoKeys.length >= MAX_INTAKE_PHOTOS)
              throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
          }
          return result;
        };
        const run = async <T>(handler: () => Promise<T>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              resolver,
              handler,
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return {
          kind: 'selection',
          company: 'SHOP',
          execute: (handler) =>
            route.endsWith('.addPhoto')
              ? procurementPreparation.run(
                  {
                    authorize: async () => {
                      await run(async () => undefined);
                    },
                    execute: run,
                  },
                  handler,
                )
              : run(handler),
        };
      });
  }
}
