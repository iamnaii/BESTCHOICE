import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PermissionKey } from '@installment/shared';
import { Prisma } from '@prisma/client';
import {
  AccessPartySourceService,
  PartySource,
  partyWriteExecution,
} from './access-party-source.service';
import { AccessResourceService } from './access-resource.service';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';

const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
const invalidFamily = () => new ConflictException('ข้อมูลการรวมลูกค้าต้องได้รับการตรวจสอบ');
/** Exact merge maintenance only. Archived records are evidence, never revived or
 * exposed as a read result. Construct only within the owned party transaction. */
export class PartyMergeSources {
  private readonly ctx;
  private readonly tx: Prisma.TransactionClient;
  constructor(
    private readonly sources: AccessPartySourceService,
    private readonly resources: AccessResourceService,
  ) {
    this.ctx = partyWriteExecution();
    if (!this.ctx) throw unavailable();
    this.tx = this.ctx.client;
  }
  private assert(sources: PartySource[], ...actions: PermissionKey[]) {
    for (const action of actions) this.sources.assert(this.ctx!.snapshot, action, sources);
  }
  private async origin(company: string, branchId: string | null = null) {
    return this.sources.origin(this.tx, company, branchId);
  }
  private async channel(channel: string, assignedToId: string | null): Promise<PartySource> {
    const company = (['SHOP', 'FINANCE'] as const).find((c) =>
      (WORK_CHANNELS[c] as readonly string[]).includes(channel),
    );
    if (!company) throw unavailable();
    // Room channels are company-wide, including SHOP rooms with no branch column.
    if (
      !(await this.tx.companyInfo.count({
        where: { companyCode: company, isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    return { company, assignedUserIds: assignedToId ? [assignedToId] : [] };
  }
  private async room(id: string, family?: Set<string>) {
    await this.tx.$queryRaw`SELECT id FROM chat_rooms WHERE id=${id} FOR SHARE`;
    const row = await this.tx.chatRoom.findUnique({ where: { id } });
    if (!row || (family && (!row.customerId || !family.has(row.customerId)))) throw unavailable();
    return this.channel(row.channel, row.assignedToId);
  }
  private async contract(id: string, family?: Set<string>) {
    await this.tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR SHARE`;
    const row = await this.tx.contract.findUnique({ where: { id } });
    if (!row || (family && !family.has(row.customerId))) throw unavailable();
    return {
      ...(await this.origin('FINANCE', row.branchId)),
      assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
    };
  }
  private async tradeIn(id: string) {
    await this.tx.$queryRaw`SELECT id FROM trade_ins WHERE id=${id} FOR SHARE`;
    const row = await this.tx.tradeIn.findUniqueOrThrow({ where: { id } });
    if (row.branchId) return this.origin('SHOP', row.branchId);
    if (row.submissionSource !== 'ONLINE') throw unavailable();
    if (
      !(await this.tx.companyInfo.count({
        where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    return { company: 'SHOP' as const };
  }
  /** Bound pre-existing reverse lineage. Root cannot itself be an alias; cycles,
   * live aliases and depth overflow are rejected before any canonical mutation. */
  private async family(root: string): Promise<Set<string>> {
    const row = await this.tx.customer.findUnique({ where: { id: root } });
    if (!row || row.mergedIntoId) throw unavailable();
    const ids = new Set([root]);
    let frontier = [root];
    for (let depth = 0; frontier.length; depth++) {
      const aliases = await this.tx.customer.findMany({
        where: { mergedIntoId: { in: frontier } },
        orderBy: { id: 'asc' },
      });
      if (!aliases.length) break;
      if (depth >= 20) throw invalidFamily();
      frontier = [];
      for (const alias of aliases) {
        if (ids.has(alias.id) || !alias.deletedAt) throw invalidFamily();
        ids.add(alias.id);
        frontier.push(alias.id);
      }
    }
    return ids;
  }
  private async customer(id: string): Promise<PartySource[]> {
    await this.tx.$queryRaw`SELECT id FROM customers WHERE id=${id} FOR UPDATE`;
    const row = await this.tx.customer.findUnique({ where: { id } });
    if (!row) throw unavailable();
    const result: PartySource[] = [];
    if (row.accessCompanyCode)
      result.push(await this.origin(row.accessCompanyCode, row.accessBranchId));
    for (const r of await this.tx.sale.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    }))
      result.push(await this.origin('SHOP', r.branchId));
    for (const r of await this.tx.contract.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    })) {
      result.push(await this.origin('SHOP', r.branchId), await this.contract(r.id));
    }
    for (const r of await this.tx.tradeIn.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    }))
      result.push(await this.tradeIn(r.id));
    for (const r of await this.tx.repairTicket.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    }))
      result.push(await this.origin('SHOP', r.branchId));
    for (const r of await this.tx.booking.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    }))
      result.push(await this.origin('SHOP', r.branchId));
    for (const r of await this.tx.chatRoom.findMany({
      where: { customerId: id },
      orderBy: { id: 'asc' },
    }))
      result.push(await this.room(r.id));
    return result.map((s) => ({
      ...s,
      assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
    }));
  }
  private async lineageCustomer(id: string, canonicalSources: PartySource[]) {
    const own = await this.customer(id);
    if (own.length) return own;
    const row = await this.tx.customer.findUniqueOrThrow({
      where: { id },
      select: { assignedToId: true },
    });
    return canonicalSources.map((source) => ({
      ...source,
      assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
    }));
  }
  private async credit(id: string, family: Set<string>, mutation = true): Promise<PartySource[]> {
    await this.tx.$queryRaw`SELECT id FROM credit_checks WHERE id=${id} FOR SHARE`;
    await this.tx
      .$queryRaw`SELECT id FROM room_credit_analyses WHERE credit_check_id=${id} ORDER BY id FOR SHARE`;
    const row = await this.tx.creditCheck.findUnique({
      where: { id },
      include: { roomAnalysis: true },
    });
    if (!row || !family.has(row.customerId)) throw unavailable();
    const result: PartySource[] = [];
    if (row.contractId) {
      const source = await this.contract(row.contractId, family);
      if (mutation) this.assert([source], 'contracts.read');
      result.push(source);
    }
    if (row.roomAnalysis) {
      const source = await this.room(row.roomAnalysis.roomId, family);
      if (mutation) this.assert([source], 'chat.read');
      result.push(source);
    }
    if (!result.length) throw unavailable();
    if (mutation) this.assert(result, 'credit-checks.read', 'credit-checks.update');
    return result;
  }
  async absorb(sourceId: string, targetId: string) {
    for (const id of [...new Set([sourceId, targetId])].sort())
      await lockCreditCustomer(this.tx, id);
    // Fixed canonical tables only; lock archived rows too before reading evidence.
    for (const table of [
      'chat_rooms',
      'credit_checks',
      'customer_tags',
      'crm_leads',
      'ads_attributions',
      'external_finance_applications',
      'customer_journey_entries',
      'chat_auto_triggers',
    ])
      await this.tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE customer_id IN (${sourceId}, ${targetId}) ORDER BY id FOR UPDATE`,
      );
    await this.tx
      .$queryRaw`SELECT customer_id FROM customer_journey_states WHERE customer_id IN (${sourceId}, ${targetId}) ORDER BY customer_id FOR UPDATE`;
    await this.tx
      .$queryRaw`SELECT id FROM customer_scores WHERE customer_id IN (${sourceId}, ${targetId}) ORDER BY id FOR UPDATE`;
    const sourceFamily = await this.family(sourceId),
      targetFamily = await this.family(targetId);
    if ([...sourceFamily].some((id) => targetFamily.has(id))) throw invalidFamily();
    for (const id of [sourceId, targetId].sort())
      await this.sources.mutation(this.tx, 'customer', id, 'customers.update');
    const source = await this.customer(sourceId),
      target = await this.customer(targetId);
    this.assert(source, 'customers.read', 'customers.update');
    this.assert(target, 'customers.read', 'customers.update');
    // Only direct aliases are rewritten, but every known lineage origin remains
    // independently checked; unknown origins use verified lineage for this link only.
    for (const id of [...sourceFamily].filter((id) => id !== sourceId).sort()) {
      this.assert(await this.lineageCustomer(id, source), 'customers.read', 'customers.update');
    }
    for (const room of await this.tx.chatRoom.findMany({
      where: { customerId: sourceId },
      orderBy: { id: 'asc' },
    }))
      this.assert([await this.room(room.id, sourceFamily)], 'chat.read', 'chat.update');
    for (const row of await this.tx.creditCheck.findMany({
      where: { customerId: sourceId },
      orderBy: { id: 'asc' },
    }))
      await this.credit(row.id, sourceFamily);
    const targetTags = new Set(
      (
        await this.tx.customerTag.findMany({
          where: { customerId: targetId, deletedAt: null },
          select: { tag: true },
        })
      ).map((r) => r.tag),
    );
    for (const row of await this.tx.customerTag.findMany({
      where: { customerId: sourceId, deletedAt: null },
    })) {
      const duplicate = targetTags.has(row.tag);
      this.assert(
        source,
        'customer-tags.read',
        duplicate ? 'customer-tags.delete' : 'customer-tags.update',
      );
      this.assert(target, 'customer-tags.read');
      if (!duplicate) this.assert(target, 'customer-tags.update');
    }
    for (const row of await this.tx.crmLead.findMany({
      where: { customerId: sourceId },
      orderBy: { id: 'asc' },
    })) {
      const independent: PartySource[] = [];
      if (row.contractId) independent.push(await this.contract(row.contractId, sourceFamily));
      if (row.channel) independent.push(await this.channel(row.channel, row.assignedToId));
      if (row.branchId) {
        const branch = await this.origin('SHOP', row.branchId);
        if (!row.contractId && !row.channel) independent.push(branch);
        else independent.push(...independent.map((s) => ({ ...s, branchId: row.branchId! })));
      }
      this.assert(
        (independent.length ? independent : source).map((s) => ({
          ...s,
          assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
        })),
        'customers.read',
        'customers.update',
      );
    }
    for (const row of await this.tx.adsAttribution.findMany({
      where: { customerId: sourceId },
      include: { chatRooms: { select: { id: true } } },
      orderBy: { id: 'asc' },
    })) {
      const independent: PartySource[] = [];
      if (row.contractId) independent.push(await this.contract(row.contractId, sourceFamily));
      for (const room of row.chatRooms) independent.push(await this.room(room.id, sourceFamily));
      this.assert(independent.length ? independent : source, 'customers.read', 'customers.update');
    }
    for (const row of await this.tx.externalFinanceApplication.findMany({
      where: { customerId: sourceId },
      orderBy: { id: 'asc' },
    })) {
      const room = await this.room(row.roomId, sourceFamily);
      this.assert([room], 'chat.read', 'chat.update');
      const application = row.branchId
        ? {
            ...(await this.origin(room.company, row.branchId)),
            assignedUserIds: room.assignedUserIds,
          }
        : room;
      this.assert([application], 'external-finance.read', 'external-finance.update');
    }
    for (const row of await this.tx.customerJourneyEntry.findMany({
      where: { customerId: sourceId },
      orderBy: { id: 'asc' },
    })) {
      if (!sourceFamily.has(row.originCustomerId)) throw unavailable();
      this.assert(
        await this.lineageCustomer(row.originCustomerId, source),
        'customers.read',
        'customers.update',
      );
      if (row.roomId)
        this.assert(
          [await this.room(row.roomId, sourceFamily)],
          'customers.read',
          'customers.update',
        );
      if (row.refType || row.refId) {
        if (!row.refType || !row.refId) throw unavailable();
        if (row.refType === 'contract')
          this.assert(
            [await this.contract(row.refId, sourceFamily)],
            'customers.read',
            'customers.update',
          );
        else if (row.refType === 'credit_check')
          this.assert(
            await this.credit(row.refId, sourceFamily, false),
            'customers.read',
            'customers.update',
          );
        else if (row.refType === 'sale') {
          const ref = await this.tx.sale.findUnique({ where: { id: row.refId } });
          if (!ref || !sourceFamily.has(ref.customerId)) throw unavailable();
          this.assert(
            [await this.origin('SHOP', ref.branchId)],
            'customers.read',
            'customers.update',
          );
        } else if (row.refType === 'booking') {
          const ref = await this.tx.booking.findUnique({ where: { id: row.refId } });
          if (!ref || !sourceFamily.has(ref.customerId)) throw unavailable();
          this.assert(
            [await this.origin('SHOP', ref.branchId)],
            'customers.read',
            'customers.update',
          );
        } else if (row.refType === 'product' && row.kind === 'PRODUCT_LINK_CLICK' && row.roomId) {
          const product = await this.resources.adjustmentProduct(this.tx, row.refId, true);
          this.assert([product], 'products.read');
        } else if (row.refType === 'audit_log') {
          const audit = await this.tx.auditLog.findUnique({ where: { id: row.refId } });
          if (
            !audit ||
            audit.entity !== 'customer' ||
            !audit.entityId ||
            !sourceFamily.has(audit.entityId)
          )
            throw unavailable();
        } else throw unavailable();
      }
    }
    // Trigger dedup, score invalidation, and frozen journey cache transfer have
    // only a Customer FK: authorized identity lineage is their maintenance source.
  }
  private async supplier(id: string): Promise<PartySource[]> {
    await this.tx.$queryRaw`SELECT id FROM suppliers WHERE id=${id} FOR UPDATE`;
    const row = await this.tx.supplier.findUniqueOrThrow({
      where: { id },
      include: {
        products: true,
        purchaseOrders: {
          include: { products: true, goodsReceivings: { include: { items: true } } },
        },
      },
    });
    const sources: PartySource[] = [];
    if (row.accessCompanyCode)
      sources.push(await this.origin(row.accessCompanyCode, row.accessBranchId));
    for (const p of row.products)
      sources.push(await this.resources.adjustmentProduct(this.tx, p.id, true));
    for (const po of row.purchaseOrders) {
      await this.tx.$queryRaw`SELECT id FROM purchase_orders WHERE id=${po.id} FOR SHARE`;
      if (po.accessCompanyCode)
        sources.push(await this.origin(po.accessCompanyCode, po.accessBranchId));
      else {
        const ids = [
          ...new Set([
            ...po.products.map((p) => p.id),
            ...po.goodsReceivings.flatMap((g) => g.items.map((i) => i.productId)),
          ]),
        ];
        if (!ids.length || ids.some((id) => !id)) throw unavailable();
        for (const id of ids)
          sources.push(await this.resources.adjustmentProduct(this.tx, id!, true));
      }
    }
    return sources;
  }
  async mergeContacts(primaryId: string, duplicateId: string) {
    for (const id of [...new Set([primaryId, duplicateId])].sort())
      await this.tx.$queryRaw`SELECT id FROM contacts WHERE id=${id} FOR UPDATE`;
    for (const table of ['customers', 'suppliers', 'external_finance_companies'])
      await this.tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE contact_id IN (${primaryId}, ${duplicateId}) ORDER BY id FOR UPDATE`,
      );
    await this.tx
      .$queryRaw`SELECT id FROM trade_ins WHERE seller_contact_id IN (${primaryId}, ${duplicateId}) ORDER BY id FOR UPDATE`;
    for (const id of [primaryId, duplicateId].sort())
      await this.sources.mutation(this.tx, 'contact', id, 'contacts.update');
    for (const id of [primaryId, duplicateId].sort()) {
      const contact = await this.tx.contact.findUniqueOrThrow({ where: { id } });
      const identity: PartySource[] = [];
      for (const row of await this.tx.customer.findMany({
        where: { contactId: id },
        orderBy: { id: 'asc' },
      })) {
        const child = await this.customer(row.id);
        if (id === duplicateId) this.assert(child, 'customers.read', 'customers.update');
        identity.push(...child);
      }
      for (const row of await this.tx.supplier.findMany({
        where: { contactId: id },
        orderBy: { id: 'asc' },
      })) {
        const child = await this.supplier(row.id);
        if (id === duplicateId) this.assert(child, 'suppliers.read', 'suppliers.update');
        identity.push(...child);
      }
      for (const row of await this.tx.tradeIn.findMany({
        where: { sellerContactId: id },
        orderBy: { id: 'asc' },
      })) {
        const child = await this.tradeIn(row.id);
        if (id === duplicateId) this.assert([child], 'trade-in.read', 'trade-in.update');
        identity.push(child);
      }
      if (await this.tx.externalFinanceCompany.count({ where: { contactId: id } })) {
        for (const company of ['SHOP', 'FINANCE'] as const) {
          if (
            !(await this.tx.companyInfo.count({
              where: { companyCode: company, isActive: true, deletedAt: null },
            }))
          )
            throw unavailable();
          const child = { company, companyOnly: true };
          this.assert([child], 'contacts.read', 'contacts.update');
          if (id === duplicateId)
            this.assert([child], 'external-finance.read', 'external-finance.update');
          identity.push(child);
        }
      }
      if (identity.length)
        this.assert(
          identity.map((s) => ({
            ...s,
            assignedUserIds: contact.assignedToId ? [contact.assignedToId] : [],
          })),
          'contacts.read',
          'contacts.update',
        );
    }
  }
}
