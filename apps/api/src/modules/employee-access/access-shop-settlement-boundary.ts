import { ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, retryable } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

@Injectable()
export class AccessShopSettlementBoundary implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    ACCESS_BOUNDARIES.set('ContractsController.shopCollectSettlement', async (req, snapshot) => {
      if (requestedAccessCompany(req) !== 'FINANCE')
        throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
      return {
        kind: 'selection',
        company: 'FINANCE',
        execute: async (handler) => {
          try {
            return (
              await this.resources.execute(
                snapshot.userId,
                'payments.create',
                'FINANCE',
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!;
                  req.user = { ...req.user, id: ctx.snapshot.userId, access: ctx.snapshot };
                  return handler();
                },
                false,
                { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result;
          } catch (error) {
            if (retryable(error, false))
              throw new ConflictException('มีการเปลี่ยนแปลงรายการพร้อมกัน กรุณาลองใหม่');
            throw error;
          }
        },
      };
    });
  }
}
