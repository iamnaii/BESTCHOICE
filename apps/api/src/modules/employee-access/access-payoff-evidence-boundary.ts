import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { authorizePayoffEvidence } from '../contracts/early-payoff-slip/managed-payoff-evidence';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { procurementPreparation } from './access-preparation-context';
import { requestedAccessCompany } from './access-shop-boundaries';

@Injectable()
export class AccessPayoffEvidenceBoundary implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly prisma: PrismaService,
  ) {}
  onModuleInit() {
    for (const method of ['earlyPayoffSlipVerify', 'earlyPayoffSlipConfirm']) {
      ACCESS_BOUNDARIES.set(`ContractsController.${method}`, async (req, snapshot) => {
        if (requestedAccessCompany(req) !== 'FINANCE')
          throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
        const id = String(req.params?.id ?? '');
        const run = async <T>(handler: () => Promise<T>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              'payments.create',
              'FINANCE',
              undefined,
              async () => {
                await authorizePayoffEvidence(this.prisma, id, snapshot.userId);
                const ctx = currentDomainAccess()!;
                req.user = { ...req.user, id: ctx.snapshot.userId, access: ctx.snapshot };
                return handler();
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return {
          kind: 'selection',
          company: 'FINANCE',
          execute:
            method === 'earlyPayoffSlipVerify'
              ? (handler) =>
                  procurementPreparation.run(
                    {
                      source: 'payoff-slip',
                      authorize: () => run(async () => undefined),
                      execute: run,
                    },
                    handler,
                  )
              : run,
        };
      });
    }
  }
}
