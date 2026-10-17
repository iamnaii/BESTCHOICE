import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessExchangeSourceService, exchangeActor } from './access-exchange-source.service';
import { contractWarrantySource, repairSource } from './access-repair-scope';
import { saleSource } from './access-sales-scope';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';
import { liveShopServiceBranch, shopServiceOriginWhere } from './access-service-origin';

const resolvedClients = new WeakMap<object, object>();

export function currentAfterSalesWhere(
  permission: PermissionKey = 'after-sales.read',
): Prisma.AfterSalesCaseWhereInput {
  const scope = currentPermissionScope(permission);
  if (!scope) throw new ForbiddenException('ต้องตรวจสิทธิ์ปัจจุบัน');
  return shopServiceOriginWhere(scope);
}
/** Same actor and exact joined client; callers must not retain a root Prisma delegate. */
export async function afterSalesActor(base: PrismaService, userId: string, client?: object) {
  const ctx = await exchangeActor(base, userId, client);
  if (ctx && ctx.scope.company !== 'SHOP') throw new ForbiddenException('งานหลังการขายอยู่ใน SHOP');
  return ctx;
}
export async function afterSalesSource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<AccessResource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM after_sales_cases WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN after_sales_cases c ON c.branch_id = b.id WHERE c.id = ${id} FOR SHARE OF b`;
  }
  const row = await tx.afterSalesCase.findFirst({
    where: { id, deletedAt: null, branch: liveShopServiceBranch },
    select: { branchId: true },
  });
  if (!row) throw new ForbiddenException('ไม่พบแหล่งเคส');
  return { company: 'SHOP', branchId: row.branchId };
}
/** A denied optional source is absent, while database/programming failures still abort. */
export async function optionalSource<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenException) return null;
    throw error;
  }
}
@Injectable()
export class AccessAfterSalesSourceService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly repairs: AccessRepairSourceService,
    private readonly exchanges: AccessExchangeSourceService,
  ) {}

  async resolve(id: string, permission: PermissionKey = 'after-sales.read', lock = true) {
    const ctx = currentDomainAccess();
    if (!ctx || ctx.scopeReads || ctx.scope.company !== 'SHOP')
      throw new ForbiddenException('ต้องมีธุรกรรมตรวจสิทธิ์ปัจจุบัน');
    const tx = ctx.client;
    const source = await afterSalesSource(tx, id, lock);
    if (!canAccess(ctx.snapshot, permission, source))
      throw new ForbiddenException('ไม่มีสิทธิ์อ่านเคส');
    const row = await tx.afterSalesCase.findUniqueOrThrow({ where: { id } });
    const allows = (key: PermissionKey, s: AccessResource | null) =>
      !!s && canAccess(ctx.snapshot, key, s);
    const customer = !!(await optionalSource(() =>
      this.repairs.customer(tx, ctx.snapshot, row.customerId).then(() => true),
    ));
    const exchangeAccess = row.exchangeRequestId
      ? await optionalSource(async () => {
          const result = await this.exchanges.request(
            row.exchangeRequestId!,
            'contract-exchanges.read',
          );
          const r = result.request;
          const old = await tx.contract.findUniqueOrThrow({
            where: { id: r.oldContractId },
            select: { productId: true, customerId: true },
          });
          const expected =
            r.mode === 'MEMO' && r.status === 'APPROVED' && r.memoAppliedAt
              ? r.newProductId
              : r.oldProductId;
          if (old.customerId !== row.customerId || old.productId !== expected) return null;
          if (r.newContractId) {
            const next = await tx.contract.findFirst({
              where: { id: r.newContractId, deletedAt: null },
              select: { customerId: true, productId: true, exchangedFromContractId: true },
            });
            if (
              !next ||
              next.customerId !== row.customerId ||
              next.productId !== r.newProductId ||
              next.exchangedFromContractId !== r.oldContractId
            )
              return null;
          }
          if (row.replacementContractId && r.newContractId !== row.replacementContractId)
            return null;
          return r.oldContractId === row.contractId &&
            r.oldProductId === row.productId &&
            (!row.replacementProductId || r.newProductId === row.replacementProductId)
            ? result
            : null;
        })
      : null;
    const product = async (id: string | null) =>
      id
        ? optionalSource(async () => {
            const source = await this.resources.product(tx, id, lock);
            if (id === row.productId && row.deviceImei) {
              const device = await tx.product.findUniqueOrThrow({
                where: { id },
                select: { imeiSerial: true },
              });
              if (device.imeiSerial && device.imeiSerial !== row.deviceImei) return null;
            }
            return allows('products.read', source) ? source : null;
          })
        : null;
    const productSource = await product(row.productId);
    const replacementProductSource = await product(row.replacementProductId);
    const contract = async (id: string | null, expectedProduct: string | null) =>
      id
        ? optionalSource(async () => {
            const source = await contractWarrantySource(tx, id, lock);
            const c = await tx.contract.findUniqueOrThrow({
              where: { id },
              select: {
                customerId: true,
                productId: true,
                parentContractId: true,
                exchangedFromContractId: true,
              },
            });
            if (
              id === row.replacementContractId &&
              (row.outcome === 'PRICED_EXCHANGE'
                ? c.exchangedFromContractId !== row.contractId ||
                  exchangeAccess?.request.newContractId !== id
                : c.parentContractId !== row.contractId)
            )
              return null;
            return c.customerId === row.customerId &&
              (!expectedProduct || c.productId === expectedProduct) &&
              allows('contracts.read', source)
              ? source
              : null;
          })
        : null;
    const appliedMemo =
      exchangeAccess?.request.mode === 'MEMO' &&
      exchangeAccess.request.status === 'APPROVED' &&
      !!exchangeAccess.request.memoAppliedAt;
    const contractSource = await contract(
      row.contractId,
      appliedMemo ? exchangeAccess!.request.newProductId : row.productId,
    );
    const replacementContractSource = await contract(
      row.replacementContractId,
      row.replacementProductId,
    );
    const sale = async (id: string | null, expectedProduct: string | null) =>
      id
        ? optionalSource(async () => {
            const source = await saleSource(tx, id, lock);
            const s = await tx.sale.findUniqueOrThrow({
              where: { id },
              select: { customerId: true, productId: true, contractId: true, deletedAt: true },
            });
            return !s.deletedAt &&
              (id !== row.saleId || !row.contractId || s.contractId === row.contractId) &&
              s.customerId === row.customerId &&
              (!expectedProduct || s.productId === expectedProduct) &&
              allows('sales.read', source)
              ? source
              : null;
          })
        : null;
    const saleAccess = await sale(row.saleId, row.productId);
    const replacementSaleAccess = await sale(row.replacementSaleId, row.replacementProductId);
    const repairAccess = row.repairTicketId
      ? await optionalSource(async () => {
          const s = await repairSource(tx, row.repairTicketId!, lock);
          const r = await tx.repairTicket.findUniqueOrThrow({
            where: { id: row.repairTicketId! },
            select: { customerId: true, productId: true, contractId: true },
          });
          return r.customerId === row.customerId &&
            r.productId === row.productId &&
            r.contractId === row.contractId &&
            allows('repair-tickets.read', s)
            ? s
            : null;
        })
      : null;
    // Current derivation is all-or-nothing. An unavailable child is NOT a business null.
    const stageVerified =
      customer &&
      (!row.contractId || !!contractSource) &&
      (!row.saleId || !!saleAccess) &&
      (!row.productId || !!productSource) &&
      (!row.replacementProductId || !!replacementProductSource) &&
      (!row.repairTicketId || !!repairAccess) &&
      (!row.exchangeRequestId || !!exchangeAccess) &&
      (!row.replacementContractId || !!replacementContractSource);
    const facts = {
      row,
      source,
      customer,
      productSource,
      replacementProductSource,
      contractSource,
      replacementContractSource,
      saleAccess,
      replacementSaleAccess,
      repairAccess,
      exchangeAccess,
      stageVerified,
    };
    if (lock) resolvedClients.set(facts, tx);
    return facts;
  }
}
export type AfterSalesSourceFacts = Awaited<ReturnType<AccessAfterSalesSourceService['resolve']>>;

export function assertAfterSalesCurrentFacts(facts: AfterSalesSourceFacts | undefined, id: string) {
  const ctx = currentDomainAccess();
  if (
    !ctx ||
    !facts ||
    resolvedClients.get(facts) !== ctx.client ||
    facts.row.id !== id ||
    !canAccess(ctx.snapshot, 'after-sales.read', facts.source)
  )
    throw new ForbiddenException('ต้องตรวจแหล่งเคสในธุรกรรมปัจจุบัน');
}
export function assertAfterSalesDerivedFacts(facts: AfterSalesSourceFacts | undefined, id: string) {
  assertAfterSalesCurrentFacts(facts, id);
  if (!facts!.stageVerified) throw new ForbiddenException('ต้องตรวจแหล่งสถานะในธุรกรรมปัจจุบัน');
}
