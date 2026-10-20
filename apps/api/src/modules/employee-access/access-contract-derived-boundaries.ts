import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { ContractsController } from '../contracts/contracts.controller';
import { ContractsListQueryDto } from '../contracts/dto/contracts-list-query.dto';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import {
  AccessPartySourceService,
  FINANCE_CONTRACT_READ_LIMIT,
} from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { PartyQueryPlan } from './access-party-query-plan';
import { contractReadFilter } from './access-contract-read-filter';
import { contractDerivedExport, withContractDerivedExport } from './access-contract-derived-export';
import { contractDerivedDashboard } from './access-contract-derived-dashboard';
import { contractDerivedMilestones, milestoneMonth } from './access-contract-derived-milestones';
import { contractDerivedSnapshot } from './access-contract-derived-snapshot';

export const CONTRACT_DERIVED_ROUTES = [
  'exportRows',
  'getDocumentDashboard',
  'getMilestonesSummary',
  'getSnapshot',
] as const;
@Injectable()
export class AccessContractDerivedBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
    private readonly modules: ModuleRef,
  ) {}
  onModuleInit() {
    for (const method of CONTRACT_DERIVED_ROUTES)
      ACCESS_BOUNDARIES.set(`ContractsController.${method}`, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'FINANCE')
          throw new ForbiddenException('สัญญาอยู่ในงานการเงิน');
        const detail = method === 'getSnapshot';
        const id = String(req.params?.id ?? '');
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'FINANCE',
              detail
                ? async (tx, _snapshot, lock) => ({
                    company: 'FINANCE',
                    resources: [await this.sources.financeContract(tx, id, lock)],
                    productIds: [],
                  })
                : undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                const plan = await PartyQueryPlan.create(ctx.client, this.sources);
                const query = { ...(req.query ?? {}) };
                delete query.company;
                if (
                  method !== 'exportRows' &&
                  Object.keys(query).some(
                    (key) => method !== 'getDocumentDashboard' || key !== 'branchId',
                  )
                )
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                if (
                  method === 'getDocumentDashboard' &&
                  query.branchId !== undefined &&
                  (typeof query.branchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(query.branchId))
                )
                  throw new BadRequestException('สาขาไม่ถูกต้อง');
                if (detail) {
                  await plan.lockContractContributors([id]);
                  return contractDerivedSnapshot(plan, id);
                }
                let where: Prisma.ContractWhereInput = plan.contract;
                const month = milestoneMonth();
                if (method === 'exportRows')
                  where = {
                    AND: [
                      (await contractReadFilter(plan, req.query ?? {})).where,
                      plan.finance('contracts.export'),
                    ],
                  };
                if (method === 'getDocumentDashboard' && query.branchId)
                  where = { AND: [where, { branchId: query.branchId }] };
                if (method === 'getMilestonesSummary')
                  where = {
                    AND: [
                      where,
                      plan.finance('payments.read'),
                      {
                        OR: [
                          { createdAt: month, status: { notIn: ['DRAFT', 'CANCELED'] } },
                          {
                            status: 'ACTIVE',
                            payments: {
                              some: {
                                dueDate: month,
                                deletedAt: null,
                                status: { in: ['PENDING', 'OVERDUE'] },
                              },
                            },
                          },
                        ],
                      },
                    ],
                  };
                const ids = await ctx.client.contract.findMany({
                  where,
                  select: { id: true },
                  orderBy: { id: 'asc' },
                  take: FINANCE_CONTRACT_READ_LIMIT + 1,
                });
                await plan.lockContractContributors(ids.map((row) => row.id));
                if (method === 'exportRows') {
                  const result = {
                    ...(await contractDerivedExport(plan, where)),
                    scope: 'authorized-sources' as const,
                  };
                  return withContractDerivedExport(result, () =>
                    this.modules
                      .get(ContractsController, { strict: false })
                      .exportRows(plainToInstance(ContractsListQueryDto, query), req.user),
                  );
                }
                if (method === 'getDocumentDashboard') return contractDerivedDashboard(plan, where);
                return contractDerivedMilestones(plan, where, month);
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return detail
          ? { kind: 'selection', company: 'FINANCE', execute }
          : { kind: 'collection', company: 'FINANCE', execute: () => execute() };
      });
  }
}
