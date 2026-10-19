import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractWorkflowStatus, Prisma } from '@prisma/client';
import { ContractPreparationList } from '@installment/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { ContractsListQueryDto } from '../contracts/dto/contracts-list-query.dto';
import { bangkokDateRange } from '../../utils/date.util';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import {
  PreparationReadProjection,
  preparationReadSelect,
} from './access-contract-preparation-projection';
import {
  PREPARATION_CONTRIBUTOR_LIMIT,
  currentPreparationSource,
  lockPreparationSources,
  preparationScope,
  preparationSourceWhere,
} from './access-contract-preparation-source';

/** Explicit selected-SHOP adapter for the two existing reads. No fallback to or
 * permission through the FINANCE projection, and no action availability inferred. */
export async function readPreparation(
  resources: AccessResourceService,
  userId: string,
  detail: boolean,
  id: string,
  query: Record<string, unknown>,
) {
  return (
    await resources.execute(
      userId,
      'contracts.read',
      'SHOP',
      undefined,
      async () => {
        const ctx = currentDomainAccess()!;
        for (const permission of ['contracts.read', 'contracts.update'] as const)
          if (
            !preparationScope(ctx.snapshot, permission, 'SHOP').tuples.some(
              (tuple) =>
                tuple.scope === 'COMPANY' || (tuple.scope === 'BRANCHES' && tuple.branchIds.length),
            )
          )
            throw new ForbiddenException('ไม่มีสิทธิ์อ่านคำขอนี้');
        const raw = { ...query };
        delete raw.company;
        delete raw.view;
        const allowed = detail
          ? []
          : [
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
        if (
          (await validate(filters)).length ||
          (!ctx.snapshot.isOwner &&
            filters.salespersonId &&
            filters.salespersonId !== ctx.snapshot.userId)
        )
          throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
        const page = filters.page ?? 1,
          limit = filters.limit ?? 50;
        if ((page - 1) * limit > 2147483647) throw new BadRequestException('หน้าไม่ถูกต้อง');
        const projection = await new PreparationReadProjection().initialize();
        const where: Prisma.ContractWhereInput = {
          AND: [preparationSourceWhere(ctx.snapshot, ['contracts.read', 'contracts.update'])],
        };
        const and = where.AND as Prisma.ContractWhereInput[];
        if (detail) {
          await currentPreparationSource(id, ['contracts.read', 'contracts.update']);
          where.id = id;
        } else {
          if (filters.branchId) where.branchId = filters.branchId;
          if (filters.workflowStatus)
            where.workflowStatus = filters.workflowStatus as ContractWorkflowStatus;
          if (filters.salespersonId) where.salespersonId = filters.salespersonId;
          if (filters.customerId)
            and.push(projection.customerWhere(), { customerId: filters.customerId });
          if (filters.startDate !== undefined || filters.endDate !== undefined)
            where.createdAt = bangkokDateRange(filters.startDate, filters.endDate);
          if (filters.search)
            and.push({
              OR: [
                { contractNumber: { contains: filters.search, mode: 'insensitive' } },
                {
                  AND: [
                    projection.customerWhere(),
                    { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
                  ],
                },
              ],
            });
        }
        const contributors = detail
          ? [{ id }]
          : await ctx.client.contract.findMany({
              where,
              select: { id: true },
              orderBy: { id: 'asc' },
              take: PREPARATION_CONTRIBUTOR_LIMIT + 1,
            });
        const ids = contributors.map((candidate) => candidate.id);
        if (!detail) await lockPreparationSources(ctx.client, ids);
        await projection.lockCustomers(ids);
        const rows = await ctx.client.contract.findMany({
          where,
          select: preparationReadSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(detail ? {} : { skip: (page - 1) * limit, take: limit }),
        });
        await projection.lockProducts(rows);
        await projection.lockDocuments(rows);
        if (detail) {
          if (!rows[0]) throw new ForbiddenException('ไม่มีสิทธิ์อ่านคำขอนี้');
          return projection.project(rows[0]);
        }
        const total = await ctx.client.contract.count({ where });
        return {
          ...paginatedResponse(
            await Promise.all(rows.map((row) => projection.project(row))),
            total,
            page,
            limit,
          ),
          view: 'SHOP_PREPARATION',
          scope: 'authorized-preactivation-applications',
        } satisfies ContractPreparationList;
      },
      false,
      { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
    )
  ).result;
}
