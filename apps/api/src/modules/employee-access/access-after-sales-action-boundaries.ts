import { MAX_INTAKE_PHOTOS } from '../after-sales/services/after-sales-case.service';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { afterSalesSource } from './access-after-sales-source.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { procurementPreparation } from './access-preparation-context';

export const AFTER_SALES_INTAKE_ROUTES = ['AfterSalesController.create'];
export const AFTER_SALES_ACTION_ROUTES = [
  'send',
  'markRepaired',
  'sendBack',
  'ret',
  'cancel',
  'addPhoto',
].map((method) => `AfterSalesController.${method}`);
export const AFTER_SALES_EXCHANGE_ACTION_ROUTES = [
  'confirmExchange',
  'deliverExchange',
  'rejectExchange',
  'switchToRepair',
  'approveExchange',
  'rejectPricedExchange',
  'cancelSwap',
].map((method) => `AfterSalesController.${method}`);
@Injectable()
export class AccessAfterSalesActionBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const route of [
      ...AFTER_SALES_ACTION_ROUTES,
      ...AFTER_SALES_EXCHANGE_ACTION_ROUTES,
      ...AFTER_SALES_INTAKE_ROUTES,
    ])
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
              route.endsWith('.create') ? undefined : resolver,
              async () => {
                try {
                  return await handler();
                } catch (error) {
                  if (
                    (AFTER_SALES_EXCHANGE_ACTION_ROUTES.includes(route) ||
                      AFTER_SALES_INTAKE_ROUTES.includes(route)) &&
                    error instanceof HttpException &&
                    [400, 409].includes(error.getStatus())
                  )
                    throw new HttpException(
                      'ไม่สามารถดำเนินการตามสถานะหรือเงื่อนไขปัจจุบัน',
                      error.getStatus(),
                    );
                  throw error;
                }
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return {
          kind: 'selection',
          company: 'SHOP',
          execute: (handler) =>
            route.endsWith('.addPhoto') || route.endsWith('.create')
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
