import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { requestedAccessCompany } from './access-shop-boundaries';

/** Activation owns one route; canonical service owns all current source and money proof. */
@Injectable()
export class AccessContractActivationBoundary implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    ACCESS_BOUNDARIES.set('ContractsController.activate', async (req, snapshot, permission) => {
      if (requestedAccessCompany(req) !== 'FINANCE')
        throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
      return {
        kind: 'selection',
        company: 'FINANCE',
        execute: async (handler) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'FINANCE',
              undefined,
              async () => {
                await handler();
                return { id: String(req.params?.id ?? '') };
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result,
      };
    });
  }
}
