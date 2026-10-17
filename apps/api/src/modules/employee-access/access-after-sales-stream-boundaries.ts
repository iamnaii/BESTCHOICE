import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccessResourceService } from './access-resource.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { requestedAccessCompany } from './access-shop-boundaries';
import { currentDomainAccess } from './access-execution-context';
export const AFTER_SALES_STREAM_ROUTES = [
  'photo',
  'purchasePhoto',
  'receiptPdf',
  'handoverPdf',
].map((method) => `AfterSalesController.${method}`);
@Injectable()
export class AccessAfterSalesStreamBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const route of AFTER_SALES_STREAM_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('งานหลังการขายอยู่ใน SHOP');
        return {
          kind: 'selection',
          company: 'SHOP',
          execute: async (handler) =>
            (
              await this.resources.execute(
                snapshot.userId,
                permission,
                'SHOP',
                undefined,
                async () => {
                  const actor = await currentDomainAccess()!.client.user.findUniqueOrThrow({
                    where: { id: snapshot.userId },
                  });
                  req.user.role = actor.role;
                  return handler();
                },
                false,
                { isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result,
        };
      });
  }
}
