import {
  repairEstimateIsCustomerCharge,
  repairActualIsCustomerCharge,
} from '../repair-tickets/utils/repair-charge-visibility';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccess } from '@installment/shared';
import { AccessResourceService } from './access-resource.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { currentDomainAccess } from './access-execution-context';
import {
  contractWarrantySelect,
  contractWarrantySource,
  repairSource,
} from './access-repair-scope';

@Injectable()
export class AccessRepairProjectionService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessRepairSourceService,
  ) {}
  async project<T>(value: T, ticketId?: string): Promise<T> {
    const ctx = currentDomainAccess();
    if (!ctx) return value;
    const warranty = async (id: string) => {
      const source = await contractWarrantySource(ctx.client, id).catch(() => null);
      if (!source || !canAccess(ctx.snapshot, 'contracts.read', source)) return null;
      return ctx.client.contract.findUnique({ where: { id }, select: contractWarrantySelect });
    };
    const walk = async (input: unknown, inherited?: string): Promise<unknown> => {
      if (
        !input ||
        typeof input !== 'object' ||
        input instanceof Date ||
        Prisma.Decimal.isDecimal(input)
      )
        return input;
      if (Array.isArray(input)) return Promise.all(input.map((v) => walk(v, inherited)));
      const row = input as Record<string, unknown>,
        out = { ...row };
      const id =
        typeof row.id === 'string' &&
        (await ctx.client.repairTicket.count({ where: { id: row.id } }))
          ? row.id
          : inherited;
      const ticket = id ? await ctx.client.repairTicket.findUnique({ where: { id } }) : null;
      const source = id ? await repairSource(ctx.client, id).catch(() => null) : null;
      const cost = !!source && canAccess(ctx.snapshot, 'sensitive.cost.read', source);
      if ('estimatedCost' in out && !(cost || (ticket && repairEstimateIsCustomerCharge(ticket))))
        out.estimatedCost = null;
      if ('actualCost' in out && !(cost || (ticket && repairActualIsCustomerCharge(ticket))))
        out.actualCost = null;
      // Free-text notes/status notes can contain internal quotes or raw replacement IDs.
      if (!cost) for (const key of ['notes', 'note']) if (key in out) out[key] = null;
      for (const [key, idKey] of [
        ['customer', 'customerId'],
        ['repairSupplier', 'repairSupplierId'],
        ['product', 'productId'],
      ] as const) {
        const nested = row[key] as { id?: unknown } | null;
        const linkedId =
          typeof row[idKey] === 'string'
            ? (row[idKey] as string)
            : typeof nested?.id === 'string'
              ? nested.id
              : undefined;
        if (!linkedId) continue;
        let projected: unknown = null;
        if (
          key === 'customer' &&
          (await this.sources.customer(ctx.client, ctx.snapshot, linkedId).then(
            () => true,
            () => false,
          ))
        )
          projected = await ctx.client.customer.findFirst({
            where: { id: linkedId, deletedAt: null },
            select: { id: true, name: true, phone: true },
          });
        if (
          key === 'repairSupplier' &&
          (await this.sources.supplier(ctx.client, ctx.snapshot, linkedId).then(
            () => true,
            () => false,
          ))
        )
          projected = await ctx.client.supplier.findFirst({
            where: { id: linkedId, deletedAt: null },
            select: { id: true, name: true, isRepairCenter: true },
          });
        if (key === 'product') {
          const p = await this.resources.product(ctx.client, linkedId).catch(() => null);
          if (p && canAccess(ctx.snapshot, 'products.read', p))
            projected = await ctx.client.product.findUnique({
              where: { id: linkedId },
              select: {
                id: true,
                brand: true,
                model: true,
                storage: true,
                imeiSerial: true,
                category: true,
                warrantyExpireDate: true,
              },
            });
        }
        if (key in out) out[key] = projected;
        if (idKey in out && !projected) out[idKey] = null;
      }
      for (const key of ['contract', 'replacementContract'] as const) {
        const idKey = `${key}Id`,
          nested = row[key] as { id?: unknown } | null;
        const cid =
          typeof row[idKey] === 'string'
            ? (row[idKey] as string)
            : typeof nested?.id === 'string'
              ? nested.id
              : undefined;
        if (!cid) continue;
        const view = await warranty(cid);
        if (key in out) out[key] = view;
        if (idKey in out && !view) out[idKey] = null;
      }
      for (const key of ['expenseDocument', 'otherIncome'] as const) {
        const idKey = `${key}Id`,
          linkedId = ticket?.[idKey];
        let view: unknown = null;
        if (linkedId && source) {
          if (key === 'expenseDocument') {
            const doc = await ctx.client.expenseDocument.findFirst({
              where: {
                id: linkedId,
                deletedAt: null,
                documentType: 'REPAIR_SERVICE',
                branchId: ticket!.branchId,
              },
              select: { id: true, number: true, status: true, totalAmount: true },
            });
            if (doc && cost && canAccess(ctx.snapshot, 'expenses.read', source)) view = doc;
          } else {
            const doc = await ctx.client.otherIncome.findFirst({
              where: {
                id: linkedId,
                deletedAt: null,
                repairTicket: { id: ticket!.id },
                customerId: ticket!.customerId,
                company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
              },
              select: { id: true, docNumber: true, status: true, totalAmount: true },
            });
            if (doc && canAccess(ctx.snapshot, 'other-income.read', source)) view = doc;
          }
        }
        if (key in out) out[key] = view;
        if (idKey in out) out[idKey] = view ? linkedId : null;
      }
      for (const [key, entry] of Object.entries(out)) {
        if (
          [
            'customer',
            'product',
            'repairSupplier',
            'contract',
            'replacementContract',
            'expenseDocument',
            'otherIncome',
          ].includes(key)
        )
          continue;
        out[key] = await walk(entry, id);
      }
      return out;
    };
    return (await walk(value, ticketId)) as T;
  }
}
