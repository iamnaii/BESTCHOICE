import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { liveShopServiceBranch } from './access-service-origin';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';

/** Financial authority has a live FINANCE company and the persisted SHOP origin.
 * Collections assignment, creator and warranty identity are never exchange assignment. */
export async function exchangeContractSource(
  tx: AccessClient,
  id: string,
  lock = true,
): Promise<AccessResource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN contracts c ON c.branch_id = b.id WHERE c.id = ${id} FOR SHARE OF b`;
    await tx.$queryRaw`SELECT id FROM company_info WHERE company_code IN ('SHOP', 'FINANCE') ORDER BY id FOR SHARE`;
  }
  const contract = await tx.contract.findFirst({
    where: { id, deletedAt: null, branch: liveShopServiceBranch },
    select: { branchId: true },
  });
  const finance = await tx.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!contract || !finance) throw new ForbiddenException('ไม่พบแหล่งสัญญาการเงิน');
  return { company: 'FINANCE', branchId: contract.branchId };
}

/** Explicit actor/current-client prerequisite shared by canonical exchange entrypoints. */
export async function exchangeActor(base: PrismaService, userId?: string, client?: object) {
  const ctx = currentDomainAccess();
  if (!ctx) {
    if (
      userId &&
      (await base.user.findUnique({ where: { id: userId }, select: { accessManaged: true } }))
        ?.accessManaged
    )
      throw new ForbiddenException('ต้องตรวจสิทธิ์ปัจจุบันในธุรกรรมก่อนดำเนินการ');
    return undefined;
  }
  if (
    ctx.scopeReads ||
    (userId && userId !== ctx.snapshot.userId) ||
    (client && !isCurrentDomainClient(client))
  )
    throw new ForbiddenException('ผู้ดำเนินการหรือธุรกรรมไม่ตรงกับสิทธิ์ปัจจุบัน');
  return ctx;
}

export type ExchangeDestinations = false | 'memo' | 'finalize' | 'cancel-memo' | 'cancel-finalized';

@Injectable()
export class AccessExchangeSourceService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly parties: AccessTradeInProjectionService,
  ) {}

  async sources(
    input: {
      oldContractId: string;
      newContractId?: string | null;
      oldProductId?: string;
      newProductId?: string;
    },
    destinations: ExchangeDestinations = false,
  ) {
    const ctx = currentDomainAccess();
    if (!ctx) throw new ForbiddenException('ต้องมีธุรกรรมตรวจสิทธิ์ปัจจุบัน');
    const tx = ctx.client;
    const sources: AccessResource[] = [];
    const productIds = new Set(
      [input.oldProductId, input.newProductId].filter((id): id is string => !!id),
    );
    for (const id of [
      ...new Set([input.oldContractId, input.newContractId].filter((id): id is string => !!id)),
    ].sort()) {
      const source = await exchangeContractSource(tx, id);
      sources.push(source);
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id },
        select: { customerId: true, productId: true },
      });
      if (
        !(await tx.customer.count({ where: { id: contract.customerId, deletedAt: null } })) ||
        (!canAccess(ctx.snapshot, 'customers.read', source) &&
          !(await this.parties.partyAllows(
            tx,
            ctx.snapshot,
            contract.customerId,
            'customerId',
            'customers.read',
          )))
      )
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านลูกค้าของสัญญา');
      productIds.add(contract.productId);
    }
    const products = new Map<string, AccessResource>();
    for (const id of [...productIds].sort()) {
      const source = await this.resources.product(tx, id, true);
      if (!canAccess(ctx.snapshot, 'products.read', source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้า');
      sources.push(source);
      products.set(id, source);
    }
    if (destinations) {
      const old = input.oldProductId ? products.get(input.oldProductId) : undefined;
      const replacement = input.newProductId ? products.get(input.newProductId) : undefined;
      if (!old || !replacement) throw new ForbiddenException('ไม่พบสินค้าต้นทางและปลายทาง');
      const reversing = destinations === 'cancel-memo' || destinations === 'cancel-finalized';
      sources.push(
        {
          company: reversing
            ? destinations === 'cancel-memo'
              ? replacement.company
              : 'FINANCE'
            : 'SHOP',
          branchId: old.branchId,
        },
        {
          company: reversing ? 'SHOP' : destinations === 'memo' ? old.company : 'FINANCE',
          branchId: replacement.branchId,
        },
      );
    }
    return sources;
  }
  permits(permission: PermissionKey, sources: readonly AccessResource[]) {
    const ctx = currentDomainAccess();
    return (
      !!ctx &&
      sources.length > 0 &&
      sources.every((source) => canAccess(ctx.snapshot, permission, source))
    );
  }
  assert(permission: PermissionKey, sources: readonly AccessResource[]) {
    if (!this.permits(permission, sources))
      throw new ForbiddenException('ไม่มีสิทธิ์เปลี่ยนเครื่องในขอบเขตนี้');
  }
  /** Internal monetary snapshots stay nullable unless independently authorized. */
  project<T>(value: T, sources: readonly AccessResource[]): T {
    const cost = this.permits('sensitive.cost.read', sources);
    const profit = this.permits('sensitive.profit.read', sources);
    const financial = this.permits('contract-exchanges.read', sources);
    const visit = (input: unknown): unknown => {
      if (!input || typeof input !== 'object' || input instanceof Date || 'toFixed' in input)
        return input;
      if (Array.isArray(input)) return input.map(visit);
      return Object.fromEntries(
        Object.entries(input).map(([key, entry]) => [
          key,
          (!cost &&
            [
              'basePrice',
              'basePriceSnapshot',
              'marketMin',
              'marketCheckPct',
              'costPrice',
              'productCostPrice',
              'previousCostPrice',
              'buybackPriceSnapshot',
            ].includes(key)) ||
          (!financial &&
            ['ncv', 'ncvSnapshot', 'grossRemainingInclVat', 'unearnedInterest'].includes(key)) ||
          (!profit && ['expectedPl', 'profit', 'margin'].includes(key))
            ? null
            : visit(entry),
        ]),
      );
    };
    return visit(value) as T;
  }
  async request(id: string, permission: PermissionKey, destinations: ExchangeDestinations = false) {
    const ctx = currentDomainAccess();
    if (!ctx) throw new ForbiddenException('ต้องมีธุรกรรมตรวจสิทธิ์ปัจจุบัน');
    await ctx.client
      .$queryRaw`SELECT id FROM contract_exchange_requests WHERE id = ${id} FOR UPDATE`;
    const request = await ctx.client.contractExchangeRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) throw new ForbiddenException('ไม่พบแหล่งคำขอเปลี่ยนเครื่อง');
    const sources = await this.sources(request, destinations);
    this.assert(permission, sources);
    return { request, sources };
  }
}
