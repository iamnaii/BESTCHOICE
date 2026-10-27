import { verifiedLoyaltySale } from '../loyalty/loyalty-sale-proof';
import { ForbiddenException } from '@nestjs/common';
import { CustomerJourneyEntry, Prisma } from '@prisma/client';
import {
  Company,
  JourneyEventGroup,
  JourneyAvailability,
  PermissionKey,
  JOURNEY_EVENT_GROUPS,
} from '@installment/shared';
import { AccessPartySourceService, PartySource } from './access-party-source.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { PartyDocumentSources } from './access-party-document-source';
import { currentDomainAccess } from './access-execution-context';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';
import { journeyEntryGroup } from '../customer-journey/sources/entries.source';
import { JOURNEY_ENTRY_KINDS } from '@installment/shared';
const denied = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
const IDENTITY_SELECT = {
  id: true,
  assignedToId: true,
  accessCompanyCode: true,
  accessBranchId: true,
  mergedIntoId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  acquisitionSource: true,
  referredById: true,
} satisfies Prisma.CustomerSelect;
type IdentityRow = Prisma.CustomerGetPayload<{ select: typeof IDENTITY_SELECT }>;
const KEYS = [
  'customer',
  'chatRoom',
  'chatFileRoom',
  'creditCheck',
  'roomCreditAnalysis',
  'sale',
  'contract',
  'paymentContract',
  'collectionContract',
  'mdmContract',
  'booking',
  'tradeIn',
  'repairTicket',
  'savingPlan',
  'onlineOrder',
  'productReservation',
  'onlineInstallmentApplication',
  'loyaltyPoint',
  'loyaltyRedemption',
  'customerJourneyEntry',
  'customerTag',
  'auditLead',
  'customerLineLink',
  'adsAttribution',
  'adsCampaign',
  'product',
] as const;
type Key = (typeof KEYS)[number];
// Coverage describes every possible contributor, not whichever rows happened
// to exist in this request. Entry identity can have any of these genuine sources.
const IDENTITY_READ_PERMISSIONS: readonly PermissionKey[] = [
  'sales.read',
  'contracts.read',
  'chat.read',
  'bookings.read',
  'repair-tickets.read',
  'trade-in.read',
];
const GROUP_REQUIREMENTS: Record<JourneyEventGroup, readonly PermissionKey[]> = {
  chat: [
    'chat.read',
    'chat-ai.read',
    'documents.read',
    'products.read',
    'sensitive.customer-identity.read',
    ...IDENTITY_READ_PERMISSIONS,
  ],
  credit: ['credit-checks.read', 'contracts.read', 'chat.read', ...IDENTITY_READ_PERMISSIONS],
  sale: [
    'sales.read',
    'contracts.read',
    'payments.read',
    'device-returns.read',
    'bookings.read',
    'shop-orders.read',
    'trade-in.read',
    ...IDENTITY_READ_PERMISSIONS,
  ],
  payment: ['contracts.read', 'payments.read'],
  collections: ['contracts.read', 'collections.read', 'mdm.read'],
  service: ['repair-tickets.read'],
  points: ['contracts.read', 'sales.read', 'loyalty.read'],
  system: ['customer-tags.read'],
};
export const LOSS_COMPANY_PERMISSIONS: Record<Company, readonly PermissionKey[]> = {
  SHOP: [
    'customers.read',
    'customer-journey.read',
    'chat.read',
    'sales.read',
    'bookings.read',
    'shop-orders.read',
    'trade-in.read',
  ],
  FINANCE: [
    'customers.read',
    'customer-journey.read',
    'chat.read',
    'contracts.read',
    'payments.read',
    'shop-orders.read',
  ],
};
/** Finite source preparation for the canonical Journey sources. Metadata is read
 * under current source locks; only independently authorized IDs reach producers. */
export class PartyJourneyPlan {
  readonly ctx = currentDomainAccess()!;
  readonly db: Prisma.TransactionClient;
  readonly ids = Object.fromEntries(KEYS.map((k) => [k, new Set<string>()])) as Record<
    Key,
    Set<string>
  >;
  readonly originalReadable = new Set<string>();
  readonly originalMutationProof = new Set<string>();
  readonly invalidIdentity = new Set<string>();
  readonly identity = new Map<string, PartySource[]>();
  readonly entryRows = new Map<string, CustomerJourneyEntry>();
  readonly entrySources = new Map<string, PartySource[]>();
  readonly undo = new Map<string, boolean>();
  readonly customers = new Map<string, IdentityRow>();
  readonly saleSources = new Map<string, PartySource>();
  readonly contractSources = new Map<string, PartySource>();
  readonly roomSources = new Map<string, PartySource>();
  readonly creditSources = new Map<string, PartySource[]>();
  family = new Set<string>();
  targetId = '';
  requestedId = '';
  lossProven = false;
  identitySensitive = false;
  referrerAllowed = false;
  acquisitionSource: string | null = null;
  readonly unprovenEntryGroups = new Set<JourneyEventGroup>();
  readonly filteredEntryGroups = new Set<JourneyEventGroup>();
  readonly unproven = new Set<Key>();
  private constructor(
    readonly party: PartyQueryPlan,
    readonly sources: AccessPartySourceService,
  ) {
    this.db = party.db;
  }
  static async create(party: PartyQueryPlan, sources: AccessPartySourceService, id: string) {
    const plan = new PartyJourneyPlan(party, sources);
    await plan.prepare(id);
    return plan;
  }
  private async lock(table: string, column: string, ids: readonly string[]) {
    if (ids.length)
      await this.db.$queryRaw(
        Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE ${Prisma.raw(column)} IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
      );
  }
  private async source(
    company: Company,
    branchId: string | null,
    assignedToId?: string | null,
  ): Promise<PartySource> {
    const base =
      branchId || company === 'FINANCE'
        ? await this.sources.origin(this.db, company, branchId)
        : await this.companySource(company);
    return { ...base, assignedUserIds: assignedToId ? [assignedToId] : [] };
  }
  private async companySource(company: Company): Promise<PartySource> {
    await this.db.$queryRaw`SELECT id FROM company_info WHERE company_code=${company} FOR SHARE`;
    if (!this.party.live.has(company)) throw denied();
    return { company };
  }
  allows(
    source: PartySource,
    permissions: readonly PermissionKey[],
    customerId?: string,
    caseAssignment = false,
  ) {
    const identity =
      customerId && !caseAssignment
        ? {
            ...source,
            assignedUserIds: this.customers.get(customerId)?.assignedToId
              ? [this.customers.get(customerId)!.assignedToId!]
              : [],
          }
        : source;
    return (
      this.party.allows('customers.read', identity) &&
      this.party.allows('customer-journey.read', identity) &&
      permissions.every((p) => this.party.allows(p, source))
    );
  }
  private async attempt<T>(work: () => Promise<T>, identityId?: string): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ForbiddenException) {
        if (identityId) this.invalidIdentity.add(identityId);
        return undefined;
      }
      throw error;
    }
  }
  private rememberIdentity(id: string, source: PartySource) {
    const assigned = this.customers.get(id)?.assignedToId;
    this.identity.set(id, [
      ...(this.identity.get(id) ?? []),
      { ...source, assignedUserIds: assigned ? [assigned] : [] },
    ]);
  }
  private allIdentity(id: string, permissions: readonly PermissionKey[]) {
    const proof = this.identity.get(id) ?? [];
    return (
      !this.invalidIdentity.has(id) &&
      proof.length > 0 &&
      proof.every((s) => permissions.every((p) => this.party.allows(p, s)))
    );
  }
  private async prepare(id: string) {
    this.requestedId = id;
    await this.lock('customers', 'id', [id]);
    let root = await this.db.customer.findUnique({ where: { id }, select: IDENTITY_SELECT });
    const seen = new Set<string>();
    while (root?.mergedIntoId) {
      if (!root.deletedAt || seen.has(root.id) || seen.size >= 20) throw denied();
      seen.add(root.id);
      await this.lock('customers', 'id', [root.mergedIntoId]);
      root = await this.db.customer.findUnique({
        where: { id: root.mergedIntoId },
        select: IDENTITY_SELECT,
      });
    }
    if (!root || root.deletedAt) throw denied();
    this.targetId = root.id;
    this.family = await new PartyDocumentSources(this.sources).family(root.id);
    await this.party.assertCustomer(root.id);
    const family = [...this.family];
    for (const row of await this.db.customer.findMany({
      where: { id: { in: family } },
      select: IDENTITY_SELECT,
    })) {
      this.customers.set(row.id, row);
      if (row.accessCompanyCode)
        await this.attempt(async () => {
          const source = await this.sources.origin(
            this.db,
            row.accessCompanyCode!,
            row.accessBranchId,
          );
          this.rememberIdentity(row.id, source);
          this.originalMutationProof.add(row.id);
          if (this.allows(source, [], row.id)) this.originalReadable.add(row.id);
        }, row.id);
    }
    // Deterministic table and row order; lock the source versions before following links.
    for (const table of [
      'sales',
      'contracts',
      'bookings',
      'trade_ins',
      'repair_tickets',
      'chat_rooms',
      'credit_checks',
      'online_orders',
      'online_installment_applications',
      'product_reservations',
      'saving_plans',
      'customer_journey_entries',
      'loyalty_points',
      'loyalty_redemptions',
      'customer_tags',
      'customer_line_links',
    ])
      await this.lock(table, 'customer_id', family);
    const customerId = { in: family };
    const sales = await this.db.sale.findMany({
      where: { customerId },
      select: {
        id: true,
        customerId: true,
        branchId: true,
        salespersonId: true,
        productId: true,
        saleSource: true,
      },
    });
    const contracts = await this.db.contract.findMany({
      where: { customerId },
      select: { id: true, customerId: true, branchId: true, assignedToId: true, productId: true },
    });
    const rooms = await this.db.chatRoom.findMany({
      where: { customerId },
      select: {
        id: true,
        customerId: true,
        channel: true,
        assignedToId: true,
        attributionId: true,
      },
    });
    for (const row of sales)
      await this.attempt(async () => {
        const source = await this.source('SHOP', row.branchId, row.salespersonId);
        this.saleSources.set(row.id, source);
        this.rememberIdentity(row.customerId, source);
        if (this.party.allows('sales.read', source)) this.originalMutationProof.add(row.customerId);
        if (this.allows(source, ['sales.read'], row.customerId)) {
          this.ids.sale.add(row.id);
          this.originalReadable.add(row.customerId);
        }
      }, row.customerId);
    for (const row of contracts)
      await this.attempt(async () => {
        const source = await this.source('FINANCE', row.branchId, row.assignedToId);
        this.contractSources.set(row.id, source);
        this.rememberIdentity(row.customerId, source);
        this.rememberIdentity(row.customerId, await this.source('SHOP', row.branchId));
        if (this.party.allows('contracts.read', source))
          this.originalMutationProof.add(row.customerId);
        if (this.allows(source, ['contracts.read'], row.customerId, true)) {
          this.ids.contract.add(row.id);
          this.originalReadable.add(row.customerId);
          for (const [key, permission] of [
            ['paymentContract', 'payments.read'],
            ['collectionContract', 'collections.read'],
            ['mdmContract', 'mdm.read'],
          ] as const)
            if (this.allows(source, [permission], row.customerId, true)) this.ids[key].add(row.id);
        }
      }, row.customerId);
    for (const row of rooms)
      await this.attempt(async () => {
        const company = (['SHOP', 'FINANCE'] as const).find((c) =>
          (WORK_CHANNELS[c] as readonly string[]).includes(row.channel),
        );
        if (!company || !row.customerId) throw denied();
        const source = await this.source(company, null, row.assignedToId);
        this.roomSources.set(row.id, source);
        this.rememberIdentity(row.customerId, source);
        if (this.party.allows('chat.read', source)) this.originalMutationProof.add(row.customerId);
        if (this.allows(source, ['chat.read'], row.customerId, true)) {
          this.ids.chatRoom.add(row.id);
          this.originalReadable.add(row.customerId);
          if (this.party.allows('documents.read', source)) this.ids.chatFileRoom.add(row.id);
        }
      }, row.customerId ?? undefined);
    for (const [key, rows, permission] of [
      [
        'booking',
        await this.db.booking.findMany({
          where: { customerId },
          select: { id: true, customerId: true, branchId: true },
        }),
        'bookings.read',
      ],
      [
        'repairTicket',
        await this.db.repairTicket.findMany({
          where: { customerId },
          select: { id: true, customerId: true, branchId: true },
        }),
        'repair-tickets.read',
      ],
      [
        'tradeIn',
        await this.db.tradeIn.findMany({
          where: { customerId },
          select: { id: true, customerId: true, branchId: true, submissionSource: true },
        }),
        'trade-in.read',
      ],
    ] as const)
      for (const row of rows)
        await this.attempt(async () => {
          if (
            !row.customerId ||
            (!row.branchId &&
              !(
                key === 'tradeIn' &&
                'submissionSource' in row &&
                row.submissionSource === 'ONLINE'
              ))
          )
            throw denied();
          const source = await this.source('SHOP', row.branchId);
          this.rememberIdentity(row.customerId, source);
          if (this.party.allows(permission, source)) this.originalMutationProof.add(row.customerId);
          if (this.allows(source, [permission], row.customerId)) {
            this.ids[key].add(row.id);
            this.originalReadable.add(row.customerId);
          }
        }, row.customerId ?? undefined);
    for (const row of this.customers.values()) {
      if (this.originalReadable.has(row.id)) this.ids.customer.add(row.id);
    }
    if (id !== root.id && !this.allIdentity(id, ['customers.read'])) throw denied();
    this.identitySensitive = (await this.party.customerSources(root.id)).some(
      (source) =>
        this.party.allows('customer-journey.read', source) &&
        this.party.allows('sensitive.customer-identity.read', source),
    );
    if (root.referredById && this.ids.customer.has(root.id)) {
      const proof = await this.attempt(() =>
        this.sources.customer(this.db, root.referredById!, true, false, true),
      );
      this.referrerAllowed = !!proof?.some(
        (source) =>
          this.party.allows('customers.read', source) &&
          this.party.allows('customer-journey.read', source),
      );
    }
    if (this.ids.customer.has(root.id)) {
      if (
        root.acquisitionSource === 'WALK_IN' ||
        (root.acquisitionSource === 'REFERRAL' && this.referrerAllowed)
      )
        this.acquisitionSource = root.acquisitionSource;
      else if (
        rooms.some(
          (room) =>
            this.ids.chatRoom.has(room.id) && `CHAT_${room.channel}` === root.acquisitionSource,
        )
      )
        this.acquisitionSource = root.acquisitionSource;
    }
    await this.lock(
      'room_credit_analyses',
      'room_id',
      rooms.map((r) => r.id),
    );
    const analyses = await this.db.roomCreditAnalysis.findMany({
      where: { roomId: { in: rooms.map((r) => r.id) } },
      select: { id: true, roomId: true, creditCheckId: true },
    });
    const checks = await this.db.creditCheck.findMany({
      where: { customerId },
      select: {
        id: true,
        customerId: true,
        contractId: true,
        roomAnalysis: { select: { roomId: true } },
      },
    });
    for (const row of checks) {
      const proof: PartySource[] = [];
      let valid = true,
        readable = true;
      if (row.contractId) {
        const source = this.contractSources.get(row.contractId);
        if (
          !source ||
          !contracts.some((c) => c.id === row.contractId && c.customerId === row.customerId)
        )
          valid = false;
        else {
          proof.push(source);
          readable = readable && this.ids.contract.has(row.contractId);
        }
      }
      if (row.roomAnalysis) {
        const source = this.roomSources.get(row.roomAnalysis.roomId);
        if (
          !source ||
          !rooms.some((r) => r.id === row.roomAnalysis!.roomId && r.customerId === row.customerId)
        )
          valid = false;
        else {
          proof.push(source);
          readable = readable && this.ids.chatRoom.has(row.roomAnalysis.roomId);
        }
      }
      this.creditSources.set(row.id, proof);
      if (
        valid &&
        readable &&
        proof.length &&
        proof.every((s) => this.allows(s, ['credit-checks.read'], row.customerId, true))
      )
        this.ids.creditCheck.add(row.id);
      if (!proof.length || !valid) this.unproven.add('creditCheck');
    }
    for (const row of analyses) {
      const source = this.roomSources.get(row.roomId);
      if (
        source &&
        this.ids.chatRoom.has(row.roomId) &&
        (!row.creditCheckId || this.ids.creditCheck.has(row.creditCheckId)) &&
        this.party.allows('credit-checks.read', source)
      )
        this.ids.roomCreditAnalysis.add(row.id);
    }
    const productRefs = await this.db.customerJourneyEntry.findMany({
      where: { customerId, kind: 'PRODUCT_LINK_CLICK', refType: 'product', refId: { not: null } },
      select: { refId: true },
    });
    const products = [
      ...new Set(
        [...sales, ...contracts].map((r) => r.productId).concat(productRefs.map((r) => r.refId!)),
      ),
    ];
    await this.lock('products', 'id', products);
    for (const p of await this.db.product.findMany({
      where: { id: { in: products }, AND: this.party.product },
      select: { id: true },
    }))
      this.ids.product.add(p.id);
    const orderRefs = await this.db.onlineOrder.findMany({
      where: { customerId },
      select: { reservationId: true },
    });
    await this.lock(
      'product_reservations',
      'id',
      orderRefs.map((row) => row.reservationId),
    );
    const orders = await this.db.onlineOrder.findMany({
      where: { customerId },
      select: {
        id: true,
        customerId: true,
        saleId: true,
        productId: true,
        reservationId: true,
        reservation: { select: { customerId: true, productId: true } },
      },
    });
    const provenOrders = new Set<string>();
    for (const row of orders) {
      const sale = sales.find(
        (s) =>
          s.id === row.saleId &&
          s.customerId === row.customerId &&
          s.productId === row.productId &&
          s.saleSource === 'ONLINE',
      );
      const source = sale && this.saleSources.get(sale.id);
      const proven =
        !!source &&
        row.reservation.productId === row.productId &&
        (!row.reservation.customerId || row.reservation.customerId === row.customerId);
      if (proven) {
        provenOrders.add(row.id);
        if (
          this.ids.sale.has(sale!.id) &&
          this.allows(source!, ['shop-orders.read'], row.customerId)
        )
          this.ids.onlineOrder.add(row.id);
      } else this.unproven.add('onlineOrder');
    }
    const applications = await this.db.onlineInstallmentApplication.findMany({
      where: { customerId },
      select: {
        id: true,
        customerId: true,
        contractId: true,
        productId: true,
        reservationId: true,
      },
    });
    const provenApplications = new Set<string>();
    for (const row of applications) {
      const contract = contracts.find(
        (c) =>
          c.id === row.contractId &&
          c.customerId === row.customerId &&
          c.productId === row.productId,
      );
      const source = contract && this.contractSources.get(contract.id);
      if (source) {
        provenApplications.add(row.id);
        if (
          this.ids.contract.has(contract!.id) &&
          this.allows(source, ['shop-orders.read'], row.customerId!, true)
        )
          this.ids.onlineInstallmentApplication.add(row.id);
      } else this.unproven.add('onlineInstallmentApplication');
    }
    const reservations = await this.db.productReservation.findMany({
      where: { customerId },
      select: { id: true, customerId: true, productId: true },
    });
    for (const row of reservations) {
      const order = orders.find(
        (o) =>
          o.reservationId === row.id &&
          o.customerId === row.customerId &&
          o.productId === row.productId &&
          provenOrders.has(o.id),
      );
      const application = applications.find(
        (a) =>
          a.reservationId === row.id &&
          a.customerId === row.customerId &&
          a.productId === row.productId &&
          provenApplications.has(a.id),
      );
      if (!order && !application) this.unproven.add('productReservation');
      else if (
        (order && this.ids.onlineOrder.has(order.id)) ||
        (application && this.ids.onlineInstallmentApplication.has(application.id))
      )
        this.ids.productReservation.add(row.id);
    }
    const savings = await this.db.savingPlan.findMany({
      where: { customerId },
      select: { id: true, customerId: true, appliedToContractId: true },
    });
    for (const row of savings) {
      const contract = contracts.find(
        (c) => c.id === row.appliedToContractId && c.customerId === row.customerId,
      );
      if (!contract || !this.contractSources.has(contract.id)) this.unproven.add('savingPlan');
      else if (this.ids.paymentContract.has(contract.id)) this.ids.savingPlan.add(row.id);
    }
    const pointRefs = await this.db.loyaltyPoint.findMany({
      where: { customerId },
      select: { paymentId: true },
    });
    await this.lock(
      'payments',
      'id',
      pointRefs.map((row) => row.paymentId),
    );
    for (const [key, rows] of [
      [
        'loyaltyPoint',
        await this.db.loyaltyPoint.findMany({
          where: { customerId },
          select: {
            id: true,
            customerId: true,
            contractId: true,
            payment: { select: { contractId: true } },
          },
        }),
      ],
      [
        'loyaltyRedemption',
        await this.db.loyaltyRedemption.findMany({
          where: { customerId },
        }),
      ],
    ] as const)
      for (const row of rows) {
        if ('saleId' in row && row.saleId) {
          const sale = await verifiedLoyaltySale(this.db, row);
          const source = sale && this.saleSources.get(sale.id);
          if (!sale || !source) this.unproven.add(key);
          else if (
            this.ids.sale.has(sale.id) &&
            this.allows(source, ['loyalty.read'], row.customerId, true)
          ) this.ids[key].add(row.id);
          continue;
        }
        const contract = contracts.find(
          (c) => c.id === row.contractId && c.customerId === row.customerId,
        );
        const source = contract && this.contractSources.get(contract.id);
        if (!source || ('payment' in row && row.payment.contractId !== row.contractId))
          this.unproven.add(key);
        else if (
          this.ids.contract.has(contract!.id) &&
          this.allows(source, ['loyalty.read'], row.customerId, true)
        )
          this.ids[key].add(row.id);
      }
    for (const row of await this.db.customerLineLink.findMany({
      where: { customerId },
      select: { id: true, channel: true },
    })) {
      const source = await this.attempt(() => this.source(row.channel as Company, null));
      if (source && this.allows(source, ['chat.read'])) this.ids.customerLineLink.add(row.id);
    }
    for (const row of await this.db.customerTag.findMany({
      where: { customerId },
      select: { id: true, customerId: true, source: true },
    })) {
      if (
        row.source === 'MANUAL' &&
        this.allIdentity(row.customerId, [
          'customers.read',
          'customer-journey.read',
          'customer-tags.read',
        ])
      )
        this.ids.customerTag.add(row.id);
      else if (
        row.source === 'AUTO' &&
        this.allIdentity(row.customerId, [
          'customers.read',
          'customer-journey.read',
          'customer-tags.read',
        ])
      ) {
        const coverage = await this.attempt(() => this.party.tags(row.customerId));
        if (coverage?.auto) this.ids.customerTag.add(row.id);
      }
    }
    for (const row of await this.db.auditLog.findMany({
      where: { entity: 'customer', entityId: { in: family }, action: 'AI_LEAD_CAPTURED' },
      select: { id: true, entityId: true, newValue: true },
    })) {
      const value = row.newValue;
      const roomId =
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.roomId === 'string'
          ? value.roomId
          : null;
      const room = rooms.find(
        (r) => r.id === roomId && r.customerId && this.family.has(r.customerId),
      );
      const source = room && this.roomSources.get(room.id);
      if (
        room &&
        source &&
        this.ids.chatRoom.has(room.id) &&
        this.party.allows('chat-ai.read', source)
      )
        this.ids.auditLead.add(row.id);
    }
    await this.prepareAds(rooms);
    for (const row of await this.db.customerJourneyEntry.findMany({
      where: { customerId },
      orderBy: { id: 'asc' },
    })) {
      this.entryRows.set(row.id, row);
      if (await this.entryReadable(row)) this.ids.customerJourneyEntry.add(row.id);
      else if (!row.deletedAt) {
        const group = journeyEntryGroup(row.kind);
        const groups = group ? [group] : JOURNEY_EVENT_GROUPS;
        // Under complete fixed source/action coverage, rejection cannot be due
        // to a narrower permission tuple. It is unavailable provenance/schema.
        // Under narrower coverage retain only a filtered marker, never expose
        // hidden-row existence by changing availability.
        for (const entryGroup of groups) {
          if (this.groupComplete(entryGroup)) {
            this.unprovenEntryGroups.add(entryGroup);
            this.unproven.add('customerJourneyEntry');
          } else this.filteredEntryGroups.add(entryGroup);
        }
      }
    }
    // Fixed authority before any comparison with the total canonical contributor set.
    if (this.lossAuthority()) {
      const active = await this.db.customerJourneyEntry.findMany({
        where: {
          customerId,
          deletedAt: null,
          kind: { in: ['MARKED_LOST', 'REOPENED', 'TOUCHPOINT'] },
        },
        select: { id: true },
      });
      const liveCounts = await Promise.all([
        this.db.sale.count({ where: { customerId, deletedAt: null } }),
        this.db.contract.count({ where: { customerId, deletedAt: null } }),
        this.db.chatRoom.count({ where: { customerId } }),
        this.db.booking.count({ where: { customerId, deletedAt: null } }),
        this.db.tradeIn.count({ where: { customerId, deletedAt: null } }),
        this.db.onlineOrder.count({ where: { customerId, deletedAt: null } }),
        this.db.onlineInstallmentApplication.count({ where: { customerId, deletedAt: null } }),
        this.db.productReservation.count({ where: { customerId } }),
        this.db.savingPlan.count({ where: { customerId, deletedAt: null } }),
      ]);
      const authorizedCounts = await Promise.all([
        this.db.sale.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.sale] } },
        }),
        this.db.contract.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.contract] } },
        }),
        this.db.chatRoom.count({ where: { customerId, id: { in: [...this.ids.chatRoom] } } }),
        this.db.booking.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.booking] } },
        }),
        this.db.tradeIn.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.tradeIn] } },
        }),
        this.db.onlineOrder.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.onlineOrder] } },
        }),
        this.db.onlineInstallmentApplication.count({
          where: {
            customerId,
            deletedAt: null,
            id: { in: [...this.ids.onlineInstallmentApplication] },
          },
        }),
        this.db.productReservation.count({
          where: { customerId, id: { in: [...this.ids.productReservation] } },
        }),
        this.db.savingPlan.count({
          where: { customerId, deletedAt: null, id: { in: [...this.ids.savingPlan] } },
        }),
      ]);
      this.lossProven =
        active.every((e) => this.ids.customerJourneyEntry.has(e.id)) &&
        liveCounts.every((n, i) => n === authorizedCounts[i]);
    }
    for (const row of this.entryRows.values()) this.undo.set(row.id, this.canUndo(row));
  }
  private async prepareAds(
    rooms: { id: string; customerId: string | null; attributionId: string | null }[],
  ) {
    const ids = rooms.map((r) => r.attributionId).filter((id): id is string => !!id);
    await this.lock('ads_attributions', 'id', ids);
    const rows = await this.db.adsAttribution.findMany({
      where: { id: { in: ids } },
      select: { id: true, customerId: true, contractId: true, campaignId: true },
    });
    for (const row of rows) {
      const room = rooms.find(
        (r) =>
          r.attributionId === row.id &&
          r.customerId &&
          (!row.customerId || row.customerId === r.customerId) &&
          this.ids.chatRoom.has(r.id) &&
          !!this.roomSources.get(r.id) &&
          this.party.allows('chat-analytics.read', this.roomSources.get(r.id)!),
      );
      const source = room && this.roomSources.get(room.id);
      if (
        !room ||
        !source ||
        !this.ids.chatRoom.has(room.id) ||
        !this.party.allows('chat-analytics.read', source)
      )
        continue;
      if (
        row.contractId &&
        (!this.ids.contract.has(row.contractId) ||
          !(await this.db.contract.count({
            where: { id: row.contractId, customerId: room.customerId! },
          })))
      )
        continue;
      this.ids.adsAttribution.add(row.id);
      if (row.campaignId) this.ids.adsCampaign.add(row.campaignId);
    }
    await this.lock('ads_campaigns', 'id', [...this.ids.adsCampaign]);
  }
  private async entryReadable(row: CustomerJourneyEntry) {
    if (
      !this.originalReadable.has(row.originCustomerId) ||
      !this.family.has(row.originCustomerId) ||
      !this.allIdentity(row.originCustomerId, ['customers.read', 'customer-journey.read']) ||
      !this.allIdentity(row.customerId, ['customers.read', 'customer-journey.read'])
    )
      return false;
    if (![...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL].includes(row.kind as never))
      return false;
    const proof = [
      ...(this.identity.get(row.originCustomerId) ?? []),
      ...(this.identity.get(row.customerId) ?? []),
    ];
    this.entrySources.set(row.id, proof);
    if (row.roomId && !this.ids.chatRoom.has(row.roomId)) return false;
    if ((JOURNEY_ENTRY_KINDS.MANUAL as readonly string[]).includes(row.kind))
      return row.origin === 'MANUAL' && !row.roomId && !row.refId && !row.refType;
    if (row.origin !== 'SYSTEM') return false;
    if (row.kind === 'CONTACT_ADDED') {
      const value = row.data;
      const fields =
        value && typeof value === 'object' && !Array.isArray(value) ? value.fields : null;
      if (
        Array.isArray(fields) &&
        fields.includes('nationalId') &&
        !proof.every((source) => this.party.allows('sensitive.customer-identity.read', source))
      )
        return false;
    }
    const required: Record<string, string> = {
      CONTRACT_ACTIVATED: 'contract',
      CONTRACT_REVIEWED: 'contract',
      DEVICE_RETURNED: 'contract',
      EARLY_PAYOFF: 'contract',
      CREDIT_CHECK_OPENED_BY: 'credit_check',
      CREDIT_AI_SCORED: 'credit_check',
      PRODUCT_LINK_CLICK: 'product',
    };
    if (required[row.kind] && row.refType !== required[row.kind]) return false;
    if (['BOT_HANDOFF', 'PRODUCT_LINK_CLICK'].includes(row.kind) && !row.roomId) return false;
    if (row.refType || row.refId) {
      if (!row.refType || !row.refId) return false;
      const key = {
        contract: 'contract',
        sale: 'sale',
        credit_check: 'creditCheck',
        booking: 'booking',
        product: 'product',
      }[row.refType] as Key | undefined;
      if (key) {
        if (!this.ids[key].has(row.refId)) return false;
      } else if (row.refType === 'audit_log') {
        const audit = await this.db.auditLog.findUnique({
          where: { id: row.refId },
          select: { entity: true, entityId: true },
        });
        if (
          !audit ||
          audit.entity !== 'customer' ||
          !audit.entityId ||
          !this.family.has(audit.entityId)
        )
          return false;
      } else return false;
    }
    if (row.kind === 'DEVICE_RETURNED' || row.kind === 'EARLY_PAYOFF') {
      const source = this.contractSources.get(row.refId!);
      if (
        !source ||
        !this.party.allows(
          row.kind === 'DEVICE_RETURNED' ? 'device-returns.read' : 'payments.read',
          source,
        )
      )
        return false;
    }
    return true;
  }
  lossAuthority() {
    return [...this.party.live].every((c) =>
      LOSS_COMPANY_PERMISSIONS[c].every((p) => this.party.company(p, c)),
    );
  }
  assertLoss() {
    if (!this.lossAuthority() || !this.lossProven) throw denied();
  }
  assertMutation() {
    if (!this.allIdentity(this.targetId, ['customers.read', 'customers.update'])) throw denied();
  }
  assertReplay(row: CustomerJourneyEntry) {
    // A replay is a mutation acknowledgement: it cannot borrow the new target's
    // identity to acknowledge an older alias entry.
    if (
      !this.allIdentity(row.originCustomerId, ['customers.read', 'customers.update']) ||
      !this.allIdentity(row.customerId, ['customers.read', 'customers.update']) ||
      !this.originalMutationProof.has(row.originCustomerId)
    )
      throw denied();
  }
  canUndo(row: CustomerJourneyEntry, now = new Date()) {
    const proof = this.entrySources.get(row.id);
    if (
      !this.ids.customerJourneyEntry.has(row.id) ||
      row.origin !== 'MANUAL' ||
      row.roomId ||
      !proof?.length ||
      !proof.every((s) => this.party.allows('customers.update', s))
    )
      return false;
    if (['MARKED_LOST', 'REOPENED'].includes(row.kind) && !this.lossProven) return false;
    return (
      (row.actorUserId === this.ctx.snapshot.userId &&
        now.getTime() - row.createdAt.getTime() <= 86400000) ||
      proof.every((s) => this.party.allows('customer-journey.moderate', s))
    );
  }
  private groupComplete(group: JourneyEventGroup) {
    return [...this.party.live].every((company) =>
      (
        ['customers.read', 'customer-journey.read', ...GROUP_REQUIREMENTS[group]] as PermissionKey[]
      ).every((permission) => this.party.company(permission, company)),
    );
  }
  availability(): Record<JourneyEventGroup, JourneyAvailability> {
    return Object.fromEntries(
      JOURNEY_EVENT_GROUPS.map((group) => {
        const keys: readonly PermissionKey[] = {
          chat: ['chat.read', 'chat-ai.read', 'documents.read'],
          credit: ['credit-checks.read'],
          sale: [
            'sales.read',
            'contracts.read',
            'bookings.read',
            'shop-orders.read',
            'trade-in.read',
          ],
          payment: ['contracts.read', 'payments.read'],
          collections: ['contracts.read', 'collections.read', 'mdm.read'],
          service: ['repair-tickets.read'],
          points: ['contracts.read', 'sales.read', 'loyalty.read'],
          system: ['customer-tags.read'],
        }[group] as PermissionKey[];
        const available = [...this.party.live].some(
          (c) =>
            keys.some((p) => this.party.has(p, c)) ||
            (group === 'chat' &&
              this.party.has('customers.read', c) &&
              this.party.has('customer-journey.read', c)),
        );
        // Stable authority-based state; never reveal whether hidden rows exist.
        const complete = this.groupComplete(group);
        const unprovenKeys: Partial<Record<JourneyEventGroup, readonly Key[]>> = {
          sale: ['savingPlan', 'onlineOrder', 'onlineInstallmentApplication', 'productReservation'],
          credit: ['creditCheck'],
          points: ['loyaltyPoint', 'loyaltyRedemption'],
        };
        const known =
          !this.unprovenEntryGroups.has(group) &&
          !(unprovenKeys[group] ?? []).some((key) => this.unproven.has(key));
        return [group, complete && known ? 'available' : available ? 'partial' : 'unavailable'];
      }),
    ) as Record<JourneyEventGroup, JourneyAvailability>;
  }
}
