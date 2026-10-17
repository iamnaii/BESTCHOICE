import { ForbiddenException } from '@nestjs/common';
import { CustomerAttachment, Prisma } from '@prisma/client';
import {
  Company,
  CustomerAttachmentSource,
  CustomerAttachmentSourceKind,
  CUSTOMER_ATTACHMENT_SENSITIVE_KEYS,
  PermissionKey,
} from '@installment/shared';
import {
  AccessPartySourceService,
  PartySource,
  partyWriteExecution,
} from './access-party-source.service';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';
const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารนี้');
export class PartyDocumentSources {
  readonly ctx = partyWriteExecution();
  readonly tx: Prisma.TransactionClient;
  constructor(private readonly sources: AccessPartySourceService) {
    if (!this.ctx) throw unavailable();
    this.tx = this.ctx.client;
  }
  async family(id: string): Promise<Set<string>> {
    await this.tx.$queryRaw`SELECT id FROM customers WHERE id=${id} FOR SHARE`;
    const root = await this.tx.customer.findUnique({ where: { id } });
    if (!root || root.deletedAt || root.mergedIntoId) throw unavailable();
    const ids = new Set([id]);
    let frontier = [id];
    for (let depth = 0; frontier.length; depth++) {
      await this.tx.$queryRaw(
        Prisma.sql`SELECT id FROM customers WHERE merged_into_id IN (${Prisma.join(frontier)}) ORDER BY id FOR SHARE`,
      );
      const aliases = await this.tx.customer.findMany({
        where: { mergedIntoId: { in: frontier } },
        orderBy: { id: 'asc' },
      });
      if (!aliases.length) break;
      if (depth >= 20 || ids.size + aliases.length > 1000) throw unavailable();
      frontier = [];
      for (const alias of aliases) {
        if (ids.has(alias.id) || !alias.deletedAt) throw unavailable();
        ids.add(alias.id);
        frontier.push(alias.id);
      }
    }
    return ids;
  }
  private async company(company: Company): Promise<PartySource> {
    await this.tx.$queryRaw`SELECT id FROM company_info WHERE company_code=${company} FOR SHARE`;
    if (
      !(await this.tx.companyInfo.count({
        where: { companyCode: company, isActive: true, deletedAt: null },
      }))
    )
      throw unavailable();
    return { company };
  }
  private async scope(company: Company, branchId: string | null) {
    return branchId ? this.sources.origin(this.tx, company, branchId) : this.company(company);
  }
  async resolve(
    originId: string,
    kind: CustomerAttachmentSourceKind,
    sourceId: string,
    company: Company,
    family: Set<string>,
  ) {
    if (!family.has(originId)) throw unavailable();
    await this.tx.$queryRaw`SELECT id FROM customers WHERE id=${originId} FOR SHARE`;
    const origin = await this.tx.customer.findUniqueOrThrow({ where: { id: originId } });
    let source: PartySource, child: PermissionKey | undefined;
    let assigned: string | null = null;
    if (kind === 'CUSTOMER_ORIGIN') {
      if (
        sourceId !== originId ||
        !origin.accessCompanyCode ||
        origin.accessCompanyCode !== company
      )
        throw unavailable();
      source = await this.sources.origin(this.tx, origin.accessCompanyCode, origin.accessBranchId);
      assigned = origin.assignedToId;
    } else if (kind === 'CHAT_ROOM') {
      await this.tx.$queryRaw`SELECT id FROM chat_rooms WHERE id=${sourceId} FOR SHARE`;
      const row = await this.tx.chatRoom.findFirst({ where: { id: sourceId, deletedAt: null } });
      if (
        !row?.customerId ||
        !family.has(row.customerId) ||
        !(WORK_CHANNELS[company] as readonly string[]).includes(row.channel)
      )
        throw unavailable();
      source = await this.company(company);
      assigned = row.assignedToId;
      child = 'chat.read';
    } else if (kind === 'CONTRACT') {
      await this.tx.$queryRaw`SELECT id FROM contracts WHERE id=${sourceId} FOR SHARE`;
      const row = await this.tx.contract.findFirst({ where: { id: sourceId, deletedAt: null } });
      if (!row || !family.has(row.customerId)) throw unavailable();
      source = await this.sources.origin(this.tx, company, row.branchId);
      assigned = company === 'FINANCE' ? row.assignedToId : null;
      child = 'contracts.read';
    } else {
      if (company !== 'SHOP') throw unavailable();
      let row: {
        customerId: string | null;
        branchId: string | null;
        submissionSource?: string;
        salespersonId?: string;
      } | null;
      if (kind === 'SALE') {
        await this.tx.$queryRaw`SELECT id FROM sales WHERE id=${sourceId} FOR SHARE`;
        row = await this.tx.sale.findFirst({ where: { id: sourceId, deletedAt: null } });
        child = 'sales.read';
      } else if (kind === 'TRADE_IN') {
        await this.tx.$queryRaw`SELECT id FROM trade_ins WHERE id=${sourceId} FOR SHARE`;
        row = await this.tx.tradeIn.findFirst({ where: { id: sourceId, deletedAt: null } });
        child = 'trade-in.read';
      } else if (kind === 'REPAIR_TICKET') {
        await this.tx.$queryRaw`SELECT id FROM repair_tickets WHERE id=${sourceId} FOR SHARE`;
        row = await this.tx.repairTicket.findFirst({ where: { id: sourceId, deletedAt: null } });
        child = 'repair-tickets.read';
      } else if (kind === 'BOOKING') {
        await this.tx.$queryRaw`SELECT id FROM bookings WHERE id=${sourceId} FOR SHARE`;
        row = await this.tx.booking.findFirst({ where: { id: sourceId, deletedAt: null } });
        child = 'bookings.read';
      } else throw unavailable();
      if (
        !row?.customerId ||
        !family.has(row.customerId) ||
        (!row.branchId && !(kind === 'TRADE_IN' && row.submissionSource === 'ONLINE'))
      )
        throw unavailable();
      source = await this.scope('SHOP', row.branchId);
      if (kind === 'SALE') assigned = row.salespersonId ?? null;
    }
    const childSource = { ...source, assignedUserIds: assigned ? [assigned] : [] };
    const baseSource = {
      ...source,
      assignedUserIds: (
        kind === 'CHAT_ROOM' || (kind === 'CONTRACT' && company === 'FINANCE')
          ? assigned
          : origin.assignedToId
      )
        ? [
            (kind === 'CHAT_ROOM' || (kind === 'CONTRACT' && company === 'FINANCE')
              ? assigned
              : origin.assignedToId)!,
          ]
        : [],
    };
    return { baseSource, childSource, child };
  }
  async authorize(
    originId: string,
    kind: CustomerAttachmentSourceKind,
    sourceId: string,
    company: Company,
    family: Set<string>,
    action: 'upload' | 'read' | 'remove',
    attachment?: CustomerAttachment,
  ) {
    const proof = await this.resolve(
      originId,
      kind,
      sourceId,
      attachment && kind === 'CHAT_ROOM' ? this.ctx!.scope.company : company,
      family,
    );
    if (proof.baseSource.company !== this.ctx!.scope.company) throw unavailable();
    const pairs = [proof];
    if (attachment) {
      const old = await this.scope(
        attachment.accessCompanyCode as Company,
        attachment.accessBranchId,
      );
      pairs.push({
        ...proof,
        baseSource: { ...old, assignedUserIds: proof.baseSource.assignedUserIds },
        childSource: { ...old, assignedUserIds: proof.childSource.assignedUserIds },
      });
    }
    for (const p of pairs) {
      this.sources.assert(this.ctx!.snapshot, 'customers.read', [p.baseSource]);
      if (p.child) this.sources.assert(this.ctx!.snapshot, p.child, [p.childSource]);
      this.sources.assert(
        this.ctx!.snapshot,
        action === 'upload' ? 'documents.create' : 'documents.read',
        [p.baseSource],
      );
      if (action !== 'upload')
        for (const key of CUSTOMER_ATTACHMENT_SENSITIVE_KEYS)
          this.sources.assert(this.ctx!.snapshot, key, [p.baseSource]);
      if (action === 'remove')
        this.sources.assert(this.ctx!.snapshot, 'documents.update', [p.baseSource]);
    }
    return proof.baseSource;
  }
  async assertCustomerRead(id: string, family: Set<string>) {
    const identity = await this.sources.customer(this.tx, id, true, false, true);
    if (
      identity.some(
        (s) =>
          s.company === this.ctx!.scope.company &&
          this.sources.allows(this.ctx!.snapshot, 'customers.read', s),
      )
    )
      return;
    // Genuine current case/room assignment may supply read-only Customer evidence.
    for (const [kind, rows] of [
      [
        'CONTRACT',
        await this.tx.contract.findMany({
          where: { customerId: id, deletedAt: null },
          select: { id: true },
        }),
      ],
      [
        'CHAT_ROOM',
        await this.tx.chatRoom.findMany({
          where: { customerId: id, deletedAt: null },
          select: { id: true },
        }),
      ],
    ] as const)
      for (const row of rows) {
        try {
          const proof = await this.resolve(id, kind, row.id, this.ctx!.scope.company, family);
          this.sources.assert(this.ctx!.snapshot, 'customers.read', [proof.baseSource]);
          this.sources.assert(this.ctx!.snapshot, proof.child!, [proof.childSource]);
          return;
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
        }
      }
    throw unavailable();
  }
  async candidates(id: string, family: Set<string>): Promise<CustomerAttachmentSource[]> {
    const rows: Array<{ kind: CustomerAttachmentSourceKind; id: string; company: Company }> = [];
    const origin = await this.tx.customer.findUniqueOrThrow({ where: { id } });
    if (origin.accessCompanyCode === this.ctx!.scope.company)
      rows.push({ kind: 'CUSTOMER_ORIGIN', id, company: this.ctx!.scope.company });
    // Candidate enumeration is not authority: resolve() locks and checks each row before disclosure.
    for (const [kind, delegate] of [
      ['SALE', this.tx.sale],
      ['CONTRACT', this.tx.contract],
      ['TRADE_IN', this.tx.tradeIn],
      ['REPAIR_TICKET', this.tx.repairTicket],
      ['BOOKING', this.tx.booking],
      ['CHAT_ROOM', this.tx.chatRoom],
    ] as const) {
      const records = await (delegate.findMany as (args: object) => Promise<Array<{ id: string }>>)(
        {
          where: { customerId: { in: [...family] }, deletedAt: null },
          select: { id: true },
          take: 1001,
          orderBy: { id: 'asc' },
        },
      );
      if (records.length > 1000) throw unavailable();
      for (const row of records) rows.push({ kind, id: row.id, company: this.ctx!.scope.company });
    }
    const result: CustomerAttachmentSource[] = [];
    for (const row of rows) {
      try {
        const source = await this.authorize(id, row.kind, row.id, row.company, family, 'upload');
        result.push({ ...row, branchId: source.branchId ?? null });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return result;
  }
}
