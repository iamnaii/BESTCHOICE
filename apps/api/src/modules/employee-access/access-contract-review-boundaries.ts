import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { exchangeContractSource } from './access-exchange-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const CONTRACT_REVIEW_ROUTES = ['submitForReview', 'approve', 'reject'].map(
  (method) => `ContractsController.${method}`,
);

@Injectable()
export class AccessContractReviewBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}

  onModuleInit() {
    for (const route of CONTRACT_REVIEW_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const submit = route === 'ContractsController.submitForReview';
        const company = submit ? 'SHOP' : 'FINANCE';
        if (requestedAccessCompany(req) !== company)
          throw new ForbiddenException('คำขอนี้อยู่คนละส่วนงาน');
        const id = String(req.params?.id ?? '');
        return {
          kind: 'selection',
          company,
          execute: async (handler) =>
            (
              await this.resources.execute(
                snapshot.userId,
                permission,
                company,
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!;
                  if (!submit) {
                    const source = await exchangeContractSource(ctx.client, id, true);
                    if (!canAccess(ctx.snapshot, 'contracts.approve', source))
                      throw new ForbiddenException('ไม่มีสิทธิ์ตรวจสัญญาการเงิน');
                  }
                  await handler();
                  const row = await ctx.client.contract.findUniqueOrThrow({
                    where: { id },
                    select: { workflowStatus: true },
                  });
                  // Mutation authority does not disclose linked records, money or private evidence.
                  return { id, workflowStatus: row.workflowStatus };
                },
                false,
                { isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result,
        };
      });
  }
}
