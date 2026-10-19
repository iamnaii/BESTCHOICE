import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContractStatus, ContractWorkflowStatus, Prisma } from '@prisma/client';
import { ContractsListQueryDto } from '../contracts/dto/contracts-list-query.dto';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { PartyQueryPlan } from './access-party-query-plan';
import { ContractReadProjection, contractReadSelect } from './access-contract-read-projection';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { bangkokDateRange } from '../../utils/date.util';

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
                const raw = { ...(req.query ?? {}) };
                delete raw.company;
                const allowed = [
                  'status',
                  'workflowStatus',
                  'branchId',
                  'customerId',
                  'salespersonId',
                  'search',
                  'startDate',
                  'endDate',
                  'page',
                  'limit',
                ];
                if (
                  Object.keys(raw).some((key) => !allowed.includes(key)) ||
                  Object.values(raw).some((value) => typeof value !== 'string')
                )
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                const filters = plainToInstance(ContractsListQueryDto, raw);
                if ((await validate(filters)).length)
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                const page = filters.page ?? 1,
                  limit = filters.limit ?? 50;
                if ((page - 1) * limit > 2147483647)
                  throw new BadRequestException('หน้าไม่ถูกต้อง');
                const where: Prisma.ContractWhereInput = { AND: [plan.contract] };
                const and = where.AND as Prisma.ContractWhereInput[];
                if (filters.branchId) where.branchId = filters.branchId;
                if (filters.workflowStatus)
                  where.workflowStatus = filters.workflowStatus as ContractWorkflowStatus;
                if (filters.salespersonId) where.salespersonId = filters.salespersonId;
                if (filters.status)
                  and.push(plan.finance('payments.read'), {
                    status: filters.status as ContractStatus,
                  });
                if (filters.customerId)
                  and.push({ customerId: filters.customerId, customer: plan.customer });
                if (filters.startDate !== undefined || filters.endDate !== undefined)
                  where.createdAt = bangkokDateRange(filters.startDate, filters.endDate);
                if (filters.search)
                  and.push({
                    OR: [
                      { contractNumber: { contains: filters.search, mode: 'insensitive' } },
                      {
                        customer: {
                          AND: [
                            plan.customer,
                            { name: { contains: filters.search, mode: 'insensitive' } },
                          ],
                        },
                      },
                    ],
                  });
                // Lock proven candidates before projection/count. A concurrent source move
                // causes the existing whole-attempt Serializable retry, then fresh policy.
                const ids = await ctx.client.contract.findMany({
                  where,
                  select: { id: true },
                  orderBy: { id: 'asc' },
                });
                for (const candidate of ids)
                  await this.sources.financeContract(ctx.client, candidate.id, true);
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
