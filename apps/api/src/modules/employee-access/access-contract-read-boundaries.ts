import { contractReadFilter } from './access-contract-read-filter';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import {
  AccessPartySourceService,
  FINANCE_CONTRACT_READ_LIMIT,
  lockFinanceContractReadSources,
} from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { PartyQueryPlan } from './access-party-query-plan';
import { ContractReadProjection, contractReadSelect } from './access-contract-read-projection';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { readPreparation } from './access-contract-preparation-read';

export const CONTRACT_READ_ROUTES = [
  'ContractsController.findAll',
  'ContractsController.findOne',
] as const;
@Injectable()
export class AccessContractReadBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const route of CONTRACT_READ_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (req.query?.view === 'preparation') {
          if (requestedAccessCompany(req) !== 'SHOP')
            throw new ForbiddenException('คำขอนี้อยู่ในงานหน้าร้าน');
          const detail = route === 'ContractsController.findOne';
          const execute = () =>
            readPreparation(
              this.resources,
              snapshot.userId,
              detail,
              String(req.params?.id ?? ''),
              req.query ?? {},
            );
          return detail
            ? { kind: 'selection', company: 'SHOP', execute }
            : { kind: 'collection', company: 'SHOP', execute };
        }
        if (requestedAccessCompany(req) !== 'FINANCE')
          throw new ForbiddenException('สัญญาอยู่ในงานการเงิน');
        const detail = route === 'ContractsController.findOne';
        const id = String(req.params?.id ?? '');
        const resolver: PersistedAccessResolver | undefined = detail
          ? async (tx, _current, lock) => ({
              company: 'FINANCE',
              resources: [await this.sources.financeContract(tx, id, lock)],
              productIds: [],
            })
          : undefined;
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'FINANCE',
              resolver,
              async () => {
                if (req.query?.view !== undefined)
                  throw new BadRequestException('รูปแบบข้อมูลไม่ถูกต้อง');
                const ctx = currentDomainAccess()!;
                const plan = await PartyQueryPlan.create(ctx.client, this.sources);
                const projection = new ContractReadProjection(plan, this.sources, this.resources);
                if (detail) {
                  const row = await ctx.client.contract.findFirst({
                    where: { id, AND: plan.contract },
                    select: contractReadSelect,
                  });
                  if (!row) throw new ForbiddenException('ไม่มีสิทธิ์อ่านสัญญานี้');
                  return projection.project(row);
                }
                const { where, page, limit } = await contractReadFilter(plan, req.query ?? {});
                // Lock proven candidates before projection/count. A concurrent source move
                // causes the existing whole-attempt Serializable retry, then fresh policy.
                const ids = await ctx.client.contract.findMany({
                  where,
                  select: { id: true },
                  orderBy: { id: 'asc' },
                  take: FINANCE_CONTRACT_READ_LIMIT + 1,
                });
                await lockFinanceContractReadSources(
                  ctx.client,
                  ids.map((candidate) => candidate.id),
                );
                const rows = await ctx.client.contract.findMany({
                  where,
                  select: contractReadSelect,
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  skip: (page - 1) * limit,
                  take: limit,
                });
                const total = await ctx.client.contract.count({ where });
                const paymentCoverage = plan.company('payments.read', 'FINANCE');
                const statusWhere = { AND: [where, plan.finance('payments.read')] };
                const [active, overdue, portfolio] = await Promise.all([
                  paymentCoverage
                    ? ctx.client.contract.count({
                        where: { AND: [statusWhere, { status: 'ACTIVE' }] },
                      })
                    : null,
                  paymentCoverage
                    ? ctx.client.contract.count({
                        where: { AND: [statusWhere, { status: { in: ['OVERDUE', 'DEFAULT'] } }] },
                      })
                    : null,
                  ctx.client.contract.aggregate({ where, _sum: { sellingPrice: true } }),
                ]);
                return {
                  ...paginatedResponse(
                    await Promise.all(rows.map((row) => projection.project(row))),
                    total,
                    page,
                    limit,
                  ),
                  scope: 'authorized-sources',
                  summary: {
                    totalContracts: total,
                    activeContracts: active,
                    overdueContracts: overdue,
                    portfolioValue: new Prisma.Decimal(portfolio._sum.sellingPrice ?? 0).toNumber(),
                    statusAvailability: paymentCoverage ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
                  },
                };
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return detail
          ? { kind: 'selection', company: 'FINANCE', execute }
          : { kind: 'collection', company: 'FINANCE', execute };
      });
  }
}
