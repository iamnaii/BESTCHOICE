import { AccessProcurementSourceService } from './access-procurement-source.service';
import { maskNationalId } from '../../utils/pii.util';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AccessResource,
  AccessSnapshot,
  Company,
  PermissionKey,
  canAccess,
} from '@installment/shared';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { permissionScopes } from './access-context';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';

export type { PartyOrigin } from '@installment/shared';
import type { PartyOrigin } from '@installment/shared';
export interface PartySource extends AccessResource {
  readonly companyOnly?: boolean;
}
const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
/** Exact current identity assignment only. Case/sales/room assignment is never a
 * substitute for authority to change the shared identity. */
function identitySources(sources: PartySource[], assignedToId: string | null): PartySource[] {
  return sources.map((source) => ({
    ...source,
    assignedUserIds: assignedToId ? [assignedToId] : [],
  }));
}
export function partyWriteExecution(client?: object) {
  const ctx = currentDomainAccess();
  if (ctx?.domain !== 'parties') return undefined;
  if (ctx.scopeReads || (client && !isCurrentDomainClient(client))) throw unavailable();
  return ctx;
}
@Injectable()
export class AccessPartySourceService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly procurement: AccessProcurementSourceService,
  ) {}
  async destination(
    tx: AccessClient,
    company: Company,
    branchId?: string | null,
    lock = true,
  ): Promise<PartyOrigin> {
    await this.origin(tx, company, branchId ?? null, lock);
    return { accessCompanyCode: company, accessBranchId: branchId ?? null };
  }
  async origin(
    tx: AccessClient,
    company: string,
    branchId: string | null,
    lock = true,
  ): Promise<PartySource> {
    if (company !== 'SHOP' && company !== 'FINANCE') throw unavailable();
    if (lock)
      await tx.$queryRaw`SELECT id FROM company_info WHERE company_code=${company} FOR SHARE`;
    if (
      !(await tx.companyInfo.count({
        where: { companyCode: company, isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    if (branchId) {
      const source = await this.resources.branch(tx, branchId, lock);
      if (source.company !== 'SHOP') throw unavailable();
    } else if (company === 'SHOP') throw unavailable();
    return { company, ...(branchId ? { branchId } : {}) };
  }
  /** Ordinary case read source; never reuse for exchange approval/mutation. */
  async financeContract(tx: AccessClient, id: string, lock = false): Promise<PartySource> {
    if (lock) await tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR SHARE`;
    const row = await tx.contract.findFirst({
      where: { id, deletedAt: null },
      select: { branchId: true, assignedToId: true },
    });
    if (!row) throw unavailable();
    return {
      ...(await this.origin(tx, 'FINANCE', row.branchId, lock)),
      assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
    };
  }
  /** Current room channel + actual room assignment. No staff branch or alias. */
  async room(tx: AccessClient, id: string, lock = false): Promise<PartySource> {
    if (lock) await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id=${id} FOR SHARE`;
    const row = await tx.chatRoom.findFirst({
      where: { id, deletedAt: null },
      select: { channel: true, assignedToId: true },
    });
    const company =
      row && (['SHOP', 'FINANCE'] as const).find((c) => WORK_CHANNELS[c].includes(row.channel));
    if (
      !company ||
      !(await tx.companyInfo.count({
        where: { companyCode: company, isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    return { company, assignedUserIds: row?.assignedToId ? [row.assignedToId] : [] };
  }
  private async shop(
    tx: AccessClient,
    branchId: string | null,
    lock: boolean,
    online = false,
  ): Promise<PartySource> {
    if (branchId) return this.origin(tx, 'SHOP', branchId, lock);
    if (
      !online ||
      !(await tx.companyInfo.count({
        where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    return { company: 'SHOP' };
  }
  private async append(
    sources: PartySource[],
    resolve: () => Promise<PartySource | PartySource[]>,
    read: boolean,
  ) {
    try {
      const result = await resolve();
      sources.push(...(Array.isArray(result) ? result : [result]));
    } catch (error) {
      // A read can use another genuine live source. Never swallow DB/transaction errors.
      if (!read || !(error instanceof ForbiddenException)) throw error;
    }
  }
  async customer(
    tx: AccessClient,
    id: string,
    lock = true,
    revival = false,
    read = false,
  ): Promise<PartySource[]> {
    if (lock) await tx.$queryRaw`SELECT id FROM customers WHERE id=${id} FOR UPDATE`;
    const row = await tx.customer.findFirst({
      where: { id, ...(revival ? {} : { deletedAt: null }) },
    });
    if (!row || row.mergedIntoId) throw unavailable();
    const sources: PartySource[] = [];
    if (row.accessCompanyCode)
      await this.append(
        sources,
        () => this.origin(tx, row.accessCompanyCode!, row.accessBranchId, lock),
        read,
      );
    if (lock) {
      await tx.$queryRaw`SELECT id FROM trade_ins WHERE customer_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM sales WHERE customer_id=${id} ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM contracts WHERE customer_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM repair_tickets WHERE customer_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM bookings WHERE customer_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE customer_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
    }
    for (const r of await tx.tradeIn.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    }))
      await this.append(
        sources,
        () => this.shop(tx, r.branchId, lock, r.submissionSource === 'ONLINE'),
        read,
      );
    for (const r of await tx.sale.findMany({ where: { customerId: id }, orderBy: { id: 'asc' } }))
      await this.append(sources, () => this.shop(tx, r.branchId, lock), read);
    for (const r of await tx.contract.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    })) {
      await this.append(sources, () => this.shop(tx, r.branchId, lock), read);
      await this.append(sources, () => this.origin(tx, 'FINANCE', r.branchId, lock), read);
    }
    for (const r of await tx.repairTicket.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    }))
      await this.append(sources, () => this.shop(tx, r.branchId, lock), read);
    for (const r of await tx.booking.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    }))
      await this.append(sources, () => this.shop(tx, r.branchId, lock), read);
    for (const r of await tx.chatRoom.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    })) {
      const company = (['SHOP', 'FINANCE'] as const).find((c) =>
        WORK_CHANNELS[c].includes(r.channel),
      );
      if (
        !company ||
        !(await tx.companyInfo.count({
          where: { companyCode: company, isActive: true, deletedAt: null },
        }))
      ) {
        if (read) continue;
        throw unavailable();
      }
      sources.push({ company });
    }
    if (!sources.length && !read) throw unavailable();
    return identitySources(sources, row.assignedToId);
  }
  async supplier(tx: AccessClient, id: string, lock = true, read = false): Promise<PartySource[]> {
    const sources = await this.procurement.supplierSources(tx, id, lock, read);
    if (!sources.length && !read) throw unavailable();
    return sources;
  }
  async contact(
    tx: AccessClient,
    id: string,
    lock = true,
    read = false,
    revival?: { ghostCustomerId?: string },
  ): Promise<PartySource[]> {
    if (revival && (!partyWriteExecution(tx) || read || !lock)) throw unavailable();
    if (lock) await tx.$queryRaw`SELECT id FROM contacts WHERE id=${id} FOR UPDATE`;
    const row = await tx.contact.findFirst({
      where: { id, ...(revival ? {} : { deletedAt: null }), isActive: true },
    });
    if (!row) throw unavailable();
    const sources: PartySource[] = [];
    if (row.accessCompanyCode)
      await this.append(
        sources,
        () => this.origin(tx, row.accessCompanyCode!, row.accessBranchId, lock),
        read,
      );
    for (const r of await tx.customer.findMany({
      where: { contactId: id, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    }))
      await this.append(sources, () => this.customer(tx, r.id, lock, false, read), read);
    if (revival?.ghostCustomerId) {
      // Only the exact persisted link of the verified ghost contributes deleted evidence.
      const ghost = await tx.customer.findFirst({
        where: {
          id: revival.ghostCustomerId,
          contactId: id,
          deletedAt: { not: null },
          mergedIntoId: null,
        },
        select: { id: true },
      });
      if (!ghost) throw unavailable();
      sources.push(...(await this.customer(tx, ghost.id, true, true)));
    }
    for (const r of await tx.supplier.findMany({
      where: { contactId: id, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    }))
      await this.append(sources, () => this.supplier(tx, r.id, lock, read), read);
    for (const r of await tx.tradeIn.findMany({
      where: { sellerContactId: id, deletedAt: null },
      orderBy: { id: 'asc' },
    })) {
      if (lock) await tx.$queryRaw`SELECT id FROM trade_ins WHERE id=${r.id} FOR SHARE`;
      await this.append(
        sources,
        () => this.shop(tx, r.branchId, lock, r.submissionSource === 'ONLINE'),
        read,
      );
    }
    // Include inactive/archived linked rows in the lock set: revival/activation
    // can add a global mutation dependency while this operation is waiting.
    if (lock && !read)
      await tx.$queryRaw`SELECT id FROM external_finance_companies WHERE contact_id=${id} ORDER BY id FOR SHARE`;
    if (
      !read &&
      (await tx.externalFinanceCompany.count({
        where: { contactId: id, deletedAt: null, isActive: true },
      }))
    ) {
      for (const company of ['SHOP', 'FINANCE'] as const) {
        if (
          !(await tx.companyInfo.count({
            where: { companyCode: company, isActive: true, deletedAt: null },
          }))
        )
          throw unavailable();
        sources.push({ company, companyOnly: true });
      }
    }
    if (!sources.length && !read) throw unavailable();
    return identitySources(sources, row.assignedToId);
  }
  allows(
    snapshot: AccessSnapshot,
    permission: PermissionKey,
    source: PartySource,
    nonAssigned = false,
  ) {
    if (!canAccess(snapshot, permission, source)) return false;
    if (snapshot.isOwner) return true;
    const tuples = permissionScopes(
      { id: snapshot.userId, access: snapshot },
      permission,
      source.company,
    );
    if (source.companyOnly) return tuples.some((t) => t.scope === 'COMPANY');
    return (
      !nonAssigned ||
      tuples.some(
        (t) =>
          t.scope === 'COMPANY' ||
          (t.scope === 'BRANCHES' && !!source.branchId && t.branchIds.includes(source.branchId)),
      )
    );
  }
  assert(
    snapshot: AccessSnapshot,
    permission: PermissionKey,
    sources: PartySource[],
    all = true,
    nonAssigned = false,
  ) {
    if (
      !sources.length ||
      !(all
        ? sources.every((s) => this.allows(snapshot, permission, s, nonAssigned))
        : sources.some((s) => this.allows(snapshot, permission, s, nonAssigned)))
    )
      throw unavailable();
  }
  async mutation(
    tx: AccessClient,
    kind: 'customer' | 'contact',
    id: string,
    permission: PermissionKey,
    revival = false,
  ) {
    const ctx = partyWriteExecution(tx);
    if (!ctx) throw unavailable();
    const sources =
      kind === 'customer'
        ? await this.customer(tx, id, true, revival)
        : await this.contact(tx, id, true);
    this.assert(ctx.snapshot, kind === 'customer' ? 'customers.read' : 'contacts.read', sources);
    this.assert(ctx.snapshot, permission, sources);
    return sources;
  }
  async assignment(
    tx: AccessClient,
    kind: 'customer' | 'contact',
    id: string | null,
    assignee: string | null | undefined,
    sources: PartySource[],
  ) {
    if (assignee === undefined) return;
    const ctx = partyWriteExecution(tx);
    if (!ctx) throw unavailable();
    const before = id
      ? (kind === 'customer'
          ? await tx.customer.findUniqueOrThrow({ where: { id }, select: { assignedToId: true } })
          : await tx.contact.findUniqueOrThrow({ where: { id }, select: { assignedToId: true } })
        ).assignedToId
      : null;
    if (before === assignee) return;
    this.assert(
      ctx.snapshot,
      kind === 'customer' ? 'customers.update' : 'contacts.update',
      sources,
      true,
      true,
    );
    if (assignee) {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${assignee} FOR SHARE`;
      if (
        !(await tx.user.count({
          where: { id: assignee, deletedAt: null, isActive: true, isSystemUser: false },
        }))
      )
        throw unavailable();
    }
  }
}

/** A disclosed ID always needs base and sensitive authority on the SAME source.
 * Input is already canonically decrypted; output deliberately cannot contain hashes,
 * ciphertext, relationships, documents or income fields. */
export function partyIdentityView(
  input: { nationalId?: string | null; guardianNationalId?: string | null },
  snapshot: AccessSnapshot,
  sources: readonly PartySource[],
  base: 'customers.read' | 'contacts.read' = 'customers.read',
) {
  const allows = (permission: PermissionKey, source: PartySource) =>
    canAccess(snapshot, permission, source) &&
    (!source.companyOnly ||
      snapshot.isOwner ||
      permissionScopes({ id: snapshot.userId, access: snapshot }, permission, source.company).some(
        (t) => t.scope === 'COMPANY',
      ));
  const allowed = sources.some(
    (source) => allows(base, source) && allows('sensitive.customer-identity.read', source),
  );
  const view = (value: string | null | undefined) =>
    value == null ? value : allowed ? value : maskNationalId(value);
  return { nationalId: view(input.nationalId), guardianNationalId: view(input.guardianNationalId) };
}
