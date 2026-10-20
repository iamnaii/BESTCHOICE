import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContractStatus, ContractWorkflowStatus, Prisma } from '@prisma/client';
import { ContractsListQueryDto } from '../contracts/dto/contracts-list-query.dto';
import { PartyQueryPlan } from './access-party-query-plan';
import { bangkokDateRange } from '../../utils/date.util';

/** Shared finite ordinary list/export filter vocabulary and inference protection. */
export async function contractReadFilter(plan: PartyQueryPlan, query: Record<string, unknown>) {
  const raw = { ...query };
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
  if ((await validate(filters)).length) throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
  const page = filters.page ?? 1,
    limit = filters.limit ?? 50;
  if ((page - 1) * limit > 2147483647) throw new BadRequestException('หน้าไม่ถูกต้อง');
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
  if (filters.customerId) and.push({ customerId: filters.customerId, customer: plan.customer });
  if (filters.startDate !== undefined || filters.endDate !== undefined)
    where.createdAt = bangkokDateRange(filters.startDate, filters.endDate);
  if (filters.search)
    and.push({
      OR: [
        { contractNumber: { contains: filters.search, mode: 'insensitive' } },
        {
          customer: {
            AND: [plan.customer, { name: { contains: filters.search, mode: 'insensitive' } }],
          },
        },
      ],
    });
  return { where, page, limit };
}
