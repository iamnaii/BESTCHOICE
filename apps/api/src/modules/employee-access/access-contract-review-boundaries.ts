import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { AccessContractPreparationActions } from './access-contract-preparation-actions';
import { currentPreparationSource } from './access-contract-preparation-source';
import { exchangeContractSource } from './access-exchange-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const CONTRACT_REVIEW_ROUTES = ['submitForReview', 'approve', 'reject'].map(
  (method) => `ContractsController.${method}`,
);

@Injectable()
export class AccessContractReviewBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly preparation: AccessContractPreparationActions,
  ) {}

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
                  if (submit) {
                    const row = await currentPreparationSource(id, ['contracts.update']);
                    // Owner is not another salesperson's submitter.
                    if (row.salespersonId !== ctx.snapshot.userId)
                      throw new ForbiddenException('เฉพาะพนักงานเจ้าของคำขอเท่านั้นที่ส่งตรวจได้');
                    await this.preparation.assertCurrentSources(row);
                  } else {
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
