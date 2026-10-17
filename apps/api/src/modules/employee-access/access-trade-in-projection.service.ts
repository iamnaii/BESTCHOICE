import { inventorySaleScopeWhere } from './access-inventory-scope';
import { Injectable } from '@nestjs/common';
import { AccessSnapshot, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';
import { permissionScopes } from './access-context';
import { currentDomainAccess } from './access-execution-context';
import {
  tradeInSource,
  tradeInScopeWhere,
  tradeInCreditJournalSource,
} from './access-trade-in-scope';
import { AccessResourceService } from './access-resource.service';
import { maskBankAccount } from '../../utils/pii.util';

@Injectable()
export class AccessTradeInProjectionService {
  constructor(private readonly resources: AccessResourceService) {}
  /** Narrow party-source seam. No unlinked party is presumed shared SHOP. */
  async partyAllows(
    tx: AccessClient,
    snapshot: AccessSnapshot,
    id: string,
    field: 'customerId' | 'sellerContactId',
    permission: PermissionKey,
  ) {
    const scope = {
      userId: snapshot.userId,
      company: 'SHOP' as const,
      permission,
      tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, 'SHOP'),
    };
    if (
      await tx.tradeIn.findFirst({
        where: { [field]: id, AND: tradeInScopeWhere(scope) },
        select: { id: true },
      })
    )
      return true;
    return !!(await tx.sale.findFirst({
      where: {
        ...(field === 'customerId' ? { customerId: id } : { customer: { contactId: id } }),
        AND: inventorySaleScopeWhere(scope),
      },
      select: { id: true },
    }));
  }
  async project<T>(value: T, sourceId?: string, reference = false): Promise<T> {
    const ctx = currentDomainAccess();
    if (!ctx) return value;
    const walk = async (input: unknown, inherited?: string): Promise<unknown> => {
      if (Array.isArray(input)) return Promise.all(input.map((v) => walk(v, inherited)));
      if (
        !input ||
        typeof input !== 'object' ||
        input instanceof Date ||
        input instanceof Prisma.Decimal ||
        Buffer.isBuffer(input)
      )
        return input;
      const row = input as Record<string, unknown>;
      const out = { ...row };
      let id = inherited;
      if (
        typeof row.id === 'string' &&
        (await ctx.client.tradeIn.findUnique({ where: { id: row.id }, select: { id: true } }))
      )
        id = row.id;
      if (!id && typeof row.voucherNumber === 'string')
        id = (
          await ctx.client.tradeIn.findUnique({
            where: { voucherNumber: row.voucherNumber },
            select: { id: true },
          })
        )?.id;
      const source = reference
        ? { company: 'SHOP' as const }
        : id
          ? await tradeInSource(ctx.client, id).catch(() => null)
          : null;
      const permits = (p: PermissionKey) => !!source && canAccess(ctx.snapshot, p, source);
      if (!permits('sensitive.cost.read'))
        for (const key of [
          'estimatedValue',
          'offeredPrice',
          'agreedPrice',
          'basePriceAtAppraisal',
          'creditBaseAmount',
          'creditBonusAmount',
          'baseAmount',
          'bonusAmount',
          'totalAmount',
          'amount',
          'price',
          'basePrice',
          'cashPrice',
          'exchangePrice',
          'maxPrice',
          'quoteBreakdown',
          'notes',
          'suggestedPrice',
          'deductValue',
          'fixedTotal',
          'pctTotal',
          'note',
        ])
          if (key in out) out[key] = null;
      if (!permits('sensitive.seller-bank.read') && typeof out.transferAccountNumber === 'string')
        out.transferAccountNumber = maskBankAccount(out.transferAccountNumber);
      if ('currentRedemptionId' in out) {
        out.creditRedeemed = !!out.currentRedemptionId;
        out.currentRedemptionId = null;
      }
      if (row.quickBuyRequestedById !== ctx.snapshot.userId) delete out.quickBuyRequestId;
      // Ciphertexts and retry fingerprints are never response fields.
      for (const key of [
        'transferAccountNumberEncrypted',
        'transferAccountNameEncrypted',
        'quickBuyRequestHash',
        'quickBuyRequestedById',
      ])
        delete out[key];
      if (!permits('documents.read'))
        for (const key of [
          'idCardPhotoUrl',
          'photoUrls',
          'sellerSignatureUrl',
          'sellerSignatureBase64',
          'sellerDeclarationSnapshot',
          'voucherPdfUrl',
        ])
          if (key in out) out[key] = Array.isArray(out[key]) ? [] : null;
      if ('creditIssueJournalId' in out) {
        const journalSource =
          id && typeof out.creditIssueJournalId === 'string'
            ? await tradeInCreditJournalSource(ctx.client, id, out.creditIssueJournalId)
            : null;
        if (!journalSource || !canAccess(ctx.snapshot, 'journal.read', journalSource))
          out.creditIssueJournalId = null;
      }
      if (
        typeof out.customerId === 'string' &&
        !(await this.partyAllows(
          ctx.client,
          ctx.snapshot,
          out.customerId,
          'customerId',
          'customers.read',
        ))
      )
        out.customerId = null;
      if (
        typeof out.sellerContactId === 'string' &&
        !(await this.partyAllows(
          ctx.client,
          ctx.snapshot,
          out.sellerContactId,
          'sellerContactId',
          'contacts.read',
        ))
      )
        out.sellerContactId = null;
      if (typeof out.productId === 'string') {
        const product = await this.resources.product(ctx.client, out.productId).catch(() => null);
        if (!product || !canAccess(ctx.snapshot, 'products.read', product)) out.productId = null;
      }
      if ('customer' in out) {
        const customerId =
          typeof row.customerId === 'string'
            ? row.customerId
            : (row.customer as { id?: string } | null)?.id;
        if (
          !customerId ||
          !(await this.partyAllows(
            ctx.client,
            ctx.snapshot,
            customerId,
            'customerId',
            'customers.read',
          ))
        )
          out.customer = null;
      }
      if ('sellerContact' in out) {
        const contactId = typeof row.sellerContactId === 'string' ? row.sellerContactId : undefined;
        if (
          !contactId ||
          !(await this.partyAllows(
            ctx.client,
            ctx.snapshot,
            contactId,
            'sellerContactId',
            'contacts.read',
          ))
        )
          out.sellerContact = null;
      }
      if ('product' in out && out.product) {
        const productId = (out.product as { id?: string }).id;
        const product = productId
          ? await this.resources.product(ctx.client, productId).catch(() => null)
          : null;
        if (!product || !canAccess(ctx.snapshot, 'products.read', product)) out.product = null;
      }
      // These are JSON payloads, never implicit delegate authorization. Expand only
      // reviewed internal response containers and dynamic reference profile keys.
      for (const key of [
        'data',
        'history',
        'tradeIn',
        'valuations',
        'items',
        'questions',
        'choices',
        'reference',
        'breakdown',
        'lines',
        'models',
        'storages',
        'conditionAnswers',
        'catalog',
      ])
        if (out[key]) out[key] = await walk(out[key], id);
      if (out.profiles && typeof out.profiles === 'object')
        out.profiles = Object.fromEntries(
          await Promise.all(
            Object.entries(out.profiles).map(async ([key, v]) => [key, await walk(v, id)]),
          ),
        );
      return out;
    };
    return (await walk(value, sourceId)) as T;
  }
}
