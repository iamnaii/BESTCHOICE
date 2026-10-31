import { CUSTOMER_ATTACHMENT_SENSITIVE_KEYS } from '@installment/shared';
import { hashPII } from '../../utils/pii.util';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { PrismaService } from '../../prisma/prisma.service';
import { supplierScopeWhere } from './access-procurement-scope';
import { tradeInScopeWhere } from './access-trade-in-scope';
import { AsyncLocalStorage } from 'node:async_hooks';
import { partyIdentityView } from './access-party-source.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import {
  Company,
  PermissionKey,
  CustomerQueryAvailability,
  ManagedCustomerProjection,
  canAccess,
  chatSourceChannel,
} from '@installment/shared';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { permissionScopes } from './access-context';
import { CollectionScope } from './access-policy.registry';
import {
  contactPartyWhere,
  customerPartyWhere,
  financeContractReadWhere,
  partyRoomReadWhere,
} from './access-party-scope';
import { warrantyContractScopeWhere, contractWarrantySelect } from './access-repair-scope';
import { saleScopeWhere } from './access-sales-scope';
import { productScopeWhere } from './access-query-scope';
import {
  AccessPartySourceService,
  PartySource,
  FINANCE_CONTRACT_READ_LIMIT,
  lockFinanceContractReadSources,
} from './access-party-source.service';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';

// Explicit basic identity/derived response contract. New model columns are not
// automatically public. Nested contributors have their own explicit selectors.
const CUSTOMER_READ_FIELDS = new Set([
  'id',
  'nationalId',
  'guardianNationalId',
  'prefix',
  'name',
  'nickname',
  'isForeigner',
  'birthDate',
  'phone',
  'phoneSecondary',
  'email',
  'lineIdFinance',
  // Task 27 — สถานะ LINE น้องเบส (verified + วันที่ผูก) จากแถว OTP · ไม่มี U-id · เห็นเท่ากับ lineIdFinance
  'financeLine',
  'lineIdShop',
  'facebookLink',
  'facebookName',
  'facebookFriends',
  'googleMapLink',
  'addressIdCard',
  'addressCurrent',
  'addressCurrentType',
  'salaryPayDay',
  'occupation',
  'occupationDetail',
  'salary',
  'workplace',
  'addressWork',
  'references',
  'documents',
  'guardianName',
  'guardianPhone',
  'guardianRelation',
  'guardianAddress',
  'referredById',
  'referredBy',
  'createdAt',
  'updatedAt',
  'assignedToId',
  'contactId',
  'acquisitionSource',
  'acquisitionSourceRaw',
  'source',
  'chatPlaceholder',
  'creditCheckStatus',
  '_count',
  'contracts',
  'warrantyContracts',
  'sales',
  'activeContracts',
  'overdueContracts',
  'activeContractCount',
  'latestCreditStatus',
  'latestCreditScore',
  'tags',
  'tier',
  'purchase',
  'latestPurchase',
  'warranty',
  'installmentBalance',
  'chatRooms',
  'lastContactAt',
  'lastContactSource',
  'assignedTo',
  'openContracts',
]);
interface PartyCreditInfo {
  creditCheckStatus: string | null;
  latestCreditStatus: string | null;
  latestCreditScore: number | null;
  availability: 'complete' | 'partial' | 'unavailable';
}
const FALSE = { id: { in: [] as string[] } };
/** Internal, exact-owned-client read plan. It is never constructed from request predicates.
 * Permissions remain evaluated by the shared original-tuple policy and source resolvers. */
export class PartyQueryPlan {
  private readonly ctx = currentDomainAccess()!;
  private readonly contractContributors = new Set<string>();
  private readonly sourceCache = new Map<string, Promise<PartySource[]>>();
  readonly live = new Set<Company>();
  customer: Prisma.CustomerWhereInput = FALSE;
  contract: Prisma.ContractWhereInput = FALSE;
  warrantyContract: Prisma.ContractWhereInput = FALSE;
  purchaseContract: Prisma.ContractWhereInput = FALSE;
  sale: Prisma.SaleWhereInput = FALSE;
  room: Prisma.ChatRoomWhereInput = FALSE;
  product: Prisma.ProductWhereInput = FALSE;
  payment: Prisma.PaymentWhereInput = FALSE;
  credit: Prisma.CreditCheckWhereInput = FALSE;
  collection: Prisma.CallLogWhereInput = FALSE;
  repossession: Prisma.RepossessionWhereInput = FALSE;
  mdm: Prisma.ContractWhereInput = FALSE;
  private constructor(
    readonly db: Prisma.TransactionClient,
    private readonly sources: AccessPartySourceService,
    readonly customerOperation: 'customers.read' | 'customers.export',
  ) {
    if (
      !this.ctx ||
      this.ctx.domain !== 'parties' ||
      this.ctx.scopeReads ||
      !isCurrentDomainClient(db)
    )
      throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลนี้');
  }
  static async create(
    db: Prisma.TransactionClient,
    sources: AccessPartySourceService,
    operation: 'customers.read' | 'customers.export' = 'customers.read',
  ) {
    const plan = new PartyQueryPlan(db, sources, operation);
    for (const c of await db.companyInfo.findMany({
      where: { companyCode: { in: ['SHOP', 'FINANCE'] }, isActive: true, deletedAt: null },
      select: { companyCode: true },
    }))
      plan.live.add(c.companyCode as Company);
    plan.contract = plan.finance('contracts.read');
    plan.warrantyContract = plan.live.has('SHOP')
      ? warrantyContractScopeWhere(plan.scope('contracts.read', 'SHOP'))
      : FALSE;
    plan.purchaseContract = { OR: [plan.contract, plan.warrantyContract] };
    plan.sale = plan.live.has('SHOP') ? saleScopeWhere(plan.scope('sales.read', 'SHOP')) : FALSE;
    plan.room = { OR: [...plan.live].map((c) => partyRoomReadWhere(plan.scope('chat.read', c))) };
    plan.product = {
      deletedAt: null,
      OR: [...plan.live].map((c) => productScopeWhere(plan.scope('products.read', c))),
    };
    plan.payment = {
      deletedAt: null,
      contract: { AND: [plan.contract, plan.finance('payments.read')] },
    };
    plan.collection = {
      deletedAt: null,
      contract: { AND: [plan.contract, plan.finance('collections.read')] },
    };
    plan.repossession = {
      deletedAt: null,
      contract: { AND: [plan.contract, plan.finance('repossessions.read')] },
    };
    plan.mdm = { AND: [plan.contract, plan.finance('mdm.read')] };
    const cases =
      plan.ctx.scope.company === 'FINANCE'
        ? { contracts: { some: { AND: [plan.contract, plan.finance(operation)] } } }
        : FALSE;
    const rooms = [...plan.live]
      .filter((c) => c === plan.ctx.scope.company)
      .map((c) => ({
        chatRooms: {
          some: {
            AND: [
              partyRoomReadWhere(plan.scope('chat.read', c)),
              partyRoomReadWhere(plan.scope(operation, c)),
            ],
          },
        },
      }));
    plan.customer = {
      deletedAt: null,
      mergedIntoId: null,
      OR: [
        ...[...plan.live]
          .filter((c) => c === plan.ctx.scope.company)
          .map((c) => customerPartyWhere(plan.scope(operation, c))),
        cases,
        ...rooms,
      ],
    };
    return plan;
  }
  /** Fresh plan per owned Serializable attempt: aggregate and label dependencies
   * share one distinct Contract budget, including rows outside a five-item preview. */
  async lockContractContributors(ids: readonly string[]) {
    const additions = [...new Set(ids)].filter((id) => !this.contractContributors.has(id));
    if (this.contractContributors.size + additions.length > FINANCE_CONTRACT_READ_LIMIT)
      throw new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
    await lockFinanceContractReadSources(this.db, additions);
    additions.forEach((id) => this.contractContributors.add(id));
  }
  get actorId() {
    return this.ctx.snapshot.userId;
  }
  async assertCustomer(id: string) {
    if (!(await this.db.customer.count({ where: { id, AND: this.customer } })))
      throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลนี้');
  }
  async contractAllows(id: string, permission: PermissionKey) {
    return !!(await this.db.contract.count({
      where: { id, AND: [this.contract, this.finance(permission)] },
    }));
  }
  coverage(permission: PermissionKey, company: Company = 'FINANCE'): 'scoped' | 'unavailable' {
    const requiresContract =
      company === 'FINANCE' &&
      ['payments.read', 'collections.read', 'receipts.read', 'mdm.read'].includes(permission);
    return this.has(permission, company) &&
      (!requiresContract || this.has('contracts.read', 'FINANCE')) &&
      (permission !== 'receipts.read' || this.has('payments.read', 'FINANCE'))
      ? 'scoped'
      : 'unavailable';
  }
  /** Receipt.paymentId is a scalar legacy link, not a FK. Validate both backlinks
   * before receipt order/limit/grouping, independently of receipt authority. */
  async receipts(customerId: string): Promise<Prisma.ReceiptWhereInput> {
    const payments = await this.db.payment.findMany({
      where: {
        AND: this.payment,
        contract: { customerId, AND: [this.contract, this.finance('receipts.read')] },
      },
      select: { id: true, contractId: true },
    });
    const groups = new Map<string, string[]>();
    for (const p of payments) groups.set(p.contractId, [...(groups.get(p.contractId) ?? []), p.id]);
    return {
      deletedAt: null,
      isVoided: false,
      OR: [...groups].map(([contractId, ids]) => ({ contractId, paymentId: { in: ids } })),
    };
  }
  private readonly creditCache = new Map<string, Promise<PartyCreditInfo>>();
  private readonly readableCreditIds = new Set<string>();

  /** Prepare only the canonical filtered candidate set, before credit filters,
   * ranking or pagination. No global population scan is needed at plan creation. */
  async prepareCredit(where: Prisma.CustomerWhereInput) {
    if (![...this.live].some((company) => this.has('credit-checks.read', company))) return;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.customer.findMany({
        where: { AND: [this.customer, where] },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      await this.loadCreditBatch(rows.map((row) => row.id));
      if (rows.length < 200) return;
      cursor = rows[rows.length - 1].id;
    }
  }
  private async loadCreditBatch(ids: string[]) {
    const missing = ids.filter((id) => !this.creditCache.has(id));
    if (!missing.length) return;
    const batch = this.readCreditBatch(missing);
    for (const id of missing)
      this.creditCache.set(
        id,
        batch.then((rows) => rows.get(id)!),
      );
    await Promise.all(missing.map((id) => this.creditCache.get(id)!));
  }
  private async readCreditBatch(ids: string[]): Promise<Map<string, PartyCreditInfo>> {
    const empty: PartyCreditInfo = {
      creditCheckStatus: null,
      latestCreditStatus: null,
      latestCreditScore: null,
      availability: 'unavailable',
    };
    if (![...this.live].some((company) => this.has('credit-checks.read', company)))
      return new Map(ids.map((id) => [id, empty]));
    const global = this.creditAuthorityComplete();
    const [contracts, rooms, customers, allCounts] = await Promise.all([
      this.db.contract.findMany({
        where: {
          customerId: { in: ids },
          AND: [this.contract, this.finance('credit-checks.read')],
          customer: this.customer,
        },
        select: { id: true, customerId: true },
      }),
      this.db.chatRoom.findMany({
        where: {
          customerId: { in: ids },
          customer: this.customer,
          OR: [...this.live].map((company) => ({
            AND: [
              partyRoomReadWhere(this.scope('chat.read', company)),
              partyRoomReadWhere(this.scope('credit-checks.read', company)),
            ],
          })),
        },
        select: { id: true, customerId: true },
      }),
      global
        ? this.db.customer.findMany({
            where: { id: { in: ids }, AND: this.customer },
            select: { id: true, creditCheckStatus: true },
          })
        : Promise.resolve<Array<{ id: string; creditCheckStatus: string }>>([]),
      global
        ? this.db.creditCheck.groupBy({
            by: ['customerId'],
            where: { customerId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          })
        : Promise.resolve<Array<{ customerId: string; _count: { _all: number } }>>([]),
    ]);
    const contractCustomers = new Map(contracts.map((row) => [row.id, row.customerId]));
    const roomCustomers = new Map(rooms.map((row) => [row.id, row.customerId]));
    const allowed = new Map<string, { status: string; aiScore: number | null }[]>();
    if (contracts.length || rooms.length) {
      let cursor: string | undefined;
      for (;;) {
        const rows = await this.db.creditCheck.findMany({
          where: {
            deletedAt: null,
            customerId: { in: ids },
            OR: [
              { contractId: { in: contracts.map((row) => row.id) } },
              { roomAnalysis: { deletedAt: null, roomId: { in: rooms.map((row) => row.id) } } },
            ],
          },
          select: {
            id: true,
            customerId: true,
            contractId: true,
            status: true,
            aiScore: true,
            roomAnalysis: { select: { roomId: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 200,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const row of rows) {
          // Concrete backlink correlation; another customer's linked record is not proof.
          if (
            (row.contractId && contractCustomers.get(row.contractId) === row.customerId) ||
            (row.roomAnalysis && roomCustomers.get(row.roomAnalysis.roomId) === row.customerId)
          ) {
            this.readableCreditIds.add(row.id);
            const group = allowed.get(row.customerId) ?? [];
            group.push(row);
            allowed.set(row.customerId, group);
          }
        }
        if (rows.length < 200) break;
        cursor = rows[rows.length - 1].id;
      }
    }
    this.credit = { deletedAt: null, id: { in: [...this.readableCreditIds] } };
    const statuses = new Map(customers.map((row) => [row.id, row.creditCheckStatus] as const));
    const counts = new Map(allCounts.map((row) => [row.customerId, row._count._all] as const));
    return new Map(
      ids.map((id) => {
        const rows = allowed.get(id) ?? [];
        const complete = global && statuses.has(id) && (counts.get(id) ?? 0) === rows.length;
        return [
          id,
          {
            creditCheckStatus: complete ? statuses.get(id)! : null,
            latestCreditStatus: rows[0]?.status ?? null,
            latestCreditScore: rows[0]?.aiScore ?? null,
            availability: complete ? 'complete' : rows.length ? 'partial' : 'unavailable',
          },
        ];
      }),
    );
  }
  async creditInfo(id: string) {
    await this.loadCreditBatch([id]);
    return this.creditCache.get(id)!;
  }
  /** Global workflow status needs fixed authority before actual completeness is inspected. */
  creditAuthorityComplete() {
    return (
      this.company('contracts.read', 'FINANCE') &&
      this.company('credit-checks.read', 'FINANCE') &&
      [...this.live].every(
        (company) =>
          this.company('chat.read', company) && this.company('credit-checks.read', company),
      )
    );
  }
  async creditStatusComplete(where: Prisma.CustomerWhereInput) {
    if (!this.creditAuthorityComplete()) return false;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.customer.findMany({
        where: { AND: [this.customer, where] },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      await this.loadCreditBatch(rows.map((row) => row.id));
      for (const row of rows)
        if ((await this.creditInfo(row.id)).availability !== 'complete') return false;
      if (rows.length < 200) return true;
      cursor = rows[rows.length - 1].id;
    }
  }
  private readonly tagCache = new Map<
    string,
    Promise<{ tags: Array<{ tag: string }>; manual: boolean; auto: boolean }>
  >();
  tags(id: string) {
    const cached = this.tagCache.get(id);
    if (cached) return cached;
    const result = (async () => {
      if (!(await this.paired(id, 'customer-tags.read')))
        return { tags: [], manual: false, auto: false };
      const manual = await this.db.customerTag.findMany({
        where: { customerId: id, deletedAt: null, source: 'MANUAL' },
        select: { tag: true },
      });
      let auto = (
        ['contracts.read', 'collections.read', 'device-returns.read', 'repossessions.read'] as const
      ).every((p) => this.company(p, 'FINANCE'));
      if (auto) {
        const contracts = await this.db.contract.findMany({
          where: { customerId: id, deletedAt: null },
          select: { id: true },
        });
        auto =
          contracts.length ===
          (await this.db.contract.count({
            where: { customerId: id, AND: this.finance('contracts.read') },
          }));
        const returns = await this.db.deviceReturn.findMany({
          where: {
            customerId: id,
            deletedAt: null,
            status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] },
          },
          select: {
            contractId: true,
            receivingBranch: {
              select: {
                isActive: true,
                deletedAt: true,
                company: { select: { companyCode: true, isActive: true, deletedAt: true } },
              },
            },
          },
        });
        const contractIds = new Set(contracts.map((c) => c.id));
        auto =
          auto &&
          returns.every(
            (r) =>
              contractIds.has(r.contractId) &&
              r.receivingBranch.isActive &&
              !r.receivingBranch.deletedAt &&
              r.receivingBranch.company?.companyCode === 'SHOP' &&
              r.receivingBranch.company.isActive &&
              !r.receivingBranch.company.deletedAt,
          );
        const repos = await this.db.repossession.findMany({
          where: { deletedAt: null, contract: { customerId: id } },
          select: { contractId: true },
        });
        auto = auto && repos.every((r) => contractIds.has(r.contractId));
      }
      const customer = await this.db.customer.findUniqueOrThrow({
        where: { id },
        select: { createdAt: true },
      });
      const automatic = auto
        ? await new CustomerTagsService(this.db as PrismaService).evaluateAutoTags(
            id,
            customer.createdAt,
          )
        : [];
      return {
        tags: [...new Set([...manual.map((t) => t.tag), ...automatic])].map((tag) => ({ tag })),
        manual: true,
        auto,
      };
    })();
    this.tagCache.set(id, result);
    return result;
  }
  async matchingDerived(
    key: 'tags' | 'creditCheckStatus',
    value: unknown,
  ): Promise<Prisma.CustomerWhereInput> {
    if (key === 'tags') {
      const filter = value as { some?: { deletedAt?: null; tag?: { in?: string[] } } };
      if (
        !filter.some?.tag?.in ||
        Object.keys(filter).some((k) => k !== 'some') ||
        Object.keys(filter.some).some((k) => !['deletedAt', 'tag'].includes(k)) ||
        Object.keys(filter.some.tag).some((k) => k !== 'in')
      )
        throw new ForbiddenException('ไม่รองรับตัวกรองแท็ก');
    } else if (
      typeof value !== 'string' &&
      (!value ||
        typeof value !== 'object' ||
        Object.keys(value).some((k) => k !== 'in') ||
        !Array.isArray((value as { in?: unknown }).in))
    ) {
      throw new ForbiddenException('ไม่รองรับตัวกรองสถานะเครดิต');
    }
    const ids: string[] = [];
    if (key === 'creditCheckStatus') {
      if (!this.creditAuthorityComplete()) return FALSE;
      for (const [id, info] of this.creditCache) {
        const status = (await info).creditCheckStatus;
        if (
          status &&
          (typeof value === 'string'
            ? value === status
            : (value as { in: string[] }).in.includes(status))
        )
          ids.push(id);
      }
      return { id: { in: ids } };
    }
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.customer.findMany({
        where: this.customer,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        const query = value as { some: { tag: { in: string[] } } };
        if ((await this.tags(row.id)).tags.some((tag) => query.some.tag.in.includes(tag.tag)))
          ids.push(row.id);
      }
      if (rows.length < 200) break;
      cursor = rows[rows.length - 1].id;
    }
    return { id: { in: ids } };
  }
  lenderReference(company?: Company) {
    return [...this.live]
      .filter((c) => !company || c === company)
      .some((c) => this.company('contacts.read', c) && this.company('external-finance.read', c));
  }
  contactWhere(): Prisma.ContactWhereInput {
    return {
      deletedAt: null,
      OR: [
        ...[...this.live]
          .filter((c) => c === this.ctx.scope.company)
          .map((c) => contactPartyWhere(this.scope('contacts.read', c))),
        ...(this.lenderReference(this.ctx.scope.company)
          ? [
              {
                isActive: true,
                externalFinanceCompany: { some: { deletedAt: null, isActive: true } },
              },
            ]
          : []),
      ],
    };
  }
  supplierWhere(): Prisma.SupplierWhereInput {
    return { OR: [...this.live].map((c) => supplierScopeWhere(this.scope('suppliers.read', c))) };
  }
  tradeInWhere(): Prisma.TradeInWhereInput {
    return this.live.has('SHOP') ? tradeInScopeWhere(this.scope('trade-in.read', 'SHOP')) : FALSE;
  }
  has(permission: PermissionKey, company: Company) {
    return this.scope(permission, company).tuples.length > 0;
  }
  warrantyContracts(customerId: string) {
    return this.db.contract.findMany({
      where: { customerId, AND: this.warrantyContract },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        ...contractWarrantySelect,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
  }
  async productView<T extends { id?: string }>(value: T | null): Promise<T | null> {
    if (!value?.id) return null;
    return (await this.db.product.count({ where: { id: value.id, AND: this.product } }))
      ? value
      : null;
  }
  private readonly metadataCache = new Map<
    string,
    Promise<{ acquisitionSource: string | null; referredById: string | null }>
  >();
  private metadata(id: string) {
    let result = this.metadataCache.get(id);
    if (!result) {
      result = this.db.customer.findUniqueOrThrow({
        where: { id },
        select: { acquisitionSource: true, referredById: true },
      });
      this.metadataCache.set(id, result);
    }
    return result;
  }
  async identity<T extends Record<string, unknown>>(row: T): Promise<ManagedCustomerProjection<T>> {
    const id = row.id as string;
    const sources = await this.customerSources(id);
    if (!sources.length) throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลนี้');
    const result: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(row).filter(([key]) => CUSTOMER_READ_FIELDS.has(key))),
      ...partyIdentityView(row, this.ctx.snapshot, sources, this.customerOperation),
    };
    for (const key of Object.keys(result))
      if (key.endsWith('Encrypted') || key.endsWith('Hash') || result[key] === undefined)
        delete result[key];
    const documentsAvailable = sources.some(
      (source) =>
        this.allows('customers.read', source) &&
        this.allows('documents.read', source) &&
        CUSTOMER_ATTACHMENT_SENSITIVE_KEYS.every((key) => this.allows(key, source)),
    );
    if ('documents' in result && !documentsAvailable) result.documents = null;
    // Re-read canonical metadata, not an already projected null from findOne.
    // Pickers may omit the raw label while still carrying a derived placeholder.
    const metadata = await this.metadata(id);
    const acquisitionAvailable = await this.acquisitionVisible(id, metadata.acquisitionSource);
    if (!acquisitionAvailable) {
      for (const key of ['acquisitionSource', 'acquisitionSourceRaw', 'source', 'chatPlaceholder'])
        if (key in result) result[key] = null;
    }
    if (!this.has('contracts.read', 'FINANCE')) {
      if (result._count) result._count = { ...(result._count as object), contracts: null };
      for (const key of ['activeContracts', 'overdueContracts', 'activeContractCount'])
        if (key in result) result[key] = null;
    }
    const credit = await this.creditInfo(id);
    for (const key of ['creditCheckStatus', 'latestCreditStatus', 'latestCreditScore'] as const)
      if (key in result) result[key] = credit[key];
    const tags = await this.tags(id);
    if ('tags' in result) result.tags = tags.manual ? tags.tags : null;
    const availability: CustomerQueryAvailability = {
      credit: credit.availability,
      acquisition: acquisitionAvailable ? 'available' : 'unavailable',
      documents: documentsAvailable ? 'available' : 'unavailable',
      contracts: this.has('contracts.read', 'FINANCE') ? 'scoped' : 'unavailable',
      warrantyContracts: this.has('contracts.read', 'SHOP') ? 'scoped' : 'unavailable',
      sales: this.has('sales.read', 'SHOP') ? 'scoped' : 'unavailable',
      chat: [...this.live].some((c) => this.has('chat.read', c)) ? 'scoped' : 'unavailable',
      manualTags: tags.manual ? 'available' : 'unavailable',
      autoTags: tags.auto ? 'available' : 'unavailable',
    };
    result.availability = availability;
    if (
      typeof result.contactId === 'string' &&
      !(await this.db.contact.count({ where: { id: result.contactId, AND: this.contactWhere() } }))
    )
      result.contactId = null;
    if (result.source === 'REFERRAL' || (result.source === 'WALK_IN' && metadata.referredById)) {
      if (
        !metadata.referredById ||
        !(await this.db.customer.count({
          where: { id: metadata.referredById, AND: this.customer },
        }))
      )
        result.source = null;
    }
    if ('purchase' in result && result.purchase) {
      const purchase = { ...(result.purchase as Record<string, unknown>) };
      if (!this.has('contracts.read', 'FINANCE')) {
        purchase.installmentTotal = null;
        purchase.installmentByState = null;
      }
      if (!this.has('sales.read', 'SHOP')) {
        purchase.cashCount = null;
        purchase.externalFinanceCount = null;
      }
      result.purchase = purchase;
    }
    return result as ManagedCustomerProjection<T>;
  }
  async tierComplete(id: string) {
    if (
      !this.company('contracts.read', 'FINANCE') ||
      !this.company('payments.read', 'FINANCE') ||
      !this.company('repossessions.read', 'FINANCE')
    )
      return false;
    const all = await this.db.contract.count({ where: { customerId: id, deletedAt: null } });
    const allowed = await this.db.contract.count({
      where: {
        customerId: id,
        AND: [this.contract, this.finance('payments.read'), this.finance('repossessions.read')],
      },
    });
    if (all !== allowed) return false;
    const [allRepos, allowedRepos] = await Promise.all([
      this.db.repossession.count({ where: { deletedAt: null, contract: { customerId: id } } }),
      this.db.repossession.count({
        where: { contract: { customerId: id }, AND: this.repossession },
      }),
    ]);
    return allRepos === allowedRepos;
  }
  scope(permission: PermissionKey, company: Company): CollectionScope {
    return {
      userId: this.ctx.snapshot.userId,
      company,
      permission,
      tuples: this.live.has(company)
        ? permissionScopes(
            { id: this.ctx.snapshot.userId, access: this.ctx.snapshot },
            permission,
            company,
          )
        : [],
    };
  }
  finance(permission: PermissionKey): Prisma.ContractWhereInput {
    return this.live.has('FINANCE')
      ? financeContractReadWhere(this.scope(permission, 'FINANCE'))
      : FALSE;
  }
  company(permission: PermissionKey, company: Company) {
    return (
      this.live.has(company) &&
      this.scope(permission, company).tuples.some((t) => t.scope === 'COMPANY')
    );
  }
  allows(permission: PermissionKey, source: PartySource) {
    return this.live.has(source.company) && canAccess(this.ctx.snapshot, permission, source);
  }
  customerSources(id: string): Promise<PartySource[]> {
    const cached = this.sourceCache.get(id);
    if (cached) return cached;
    const result = (async () => {
      const identity = await this.sources.customer(this.db, id, false, false, true);
      const cases = await this.db.contract.findMany({
        where: { customerId: id, assignedToId: this.ctx.snapshot.userId, AND: this.contract },
        select: { id: true },
      });
      for (const row of cases) identity.push(await this.sources.financeContract(this.db, row.id));
      const rooms = await this.db.chatRoom.findMany({
        where: { customerId: id, assignedToId: this.ctx.snapshot.userId, AND: this.room },
        select: { id: true },
      });
      for (const row of rooms) identity.push(await this.sources.room(this.db, row.id));
      return identity.filter(
        (source) =>
          source.company === this.ctx.scope.company && this.allows(this.customerOperation, source),
      );
    })();
    this.sourceCache.set(id, result);
    return result;
  }
  async paired(id: string, permission: PermissionKey) {
    return (await this.customerSources(id)).some((source) => this.allows(permission, source));
  }
  async nationalIdMatches(filter: Prisma.StringNullableFilter): Promise<Prisma.CustomerWhereInput> {
    const ids: string[] = [];
    const raw = typeof filter.contains === 'string' ? filter.contains : undefined;
    const hash =
      raw && /^\d{13}$/.test(raw) && process.env.PII_HASH_SALT
        ? hashPII(raw, process.env.PII_HASH_SALT)
        : undefined;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.customer.findMany({
        where: {
          AND: [
            this.customer,
            { OR: [{ nationalId: filter }, ...(hash ? [{ nationalIdHash: hash }] : [])] },
          ],
        },
        select: { id: true },
        take: 200,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows)
        if (await this.paired(row.id, 'sensitive.customer-identity.read')) ids.push(row.id);
      if (rows.length < 200) break;
      cursor = rows[rows.length - 1].id;
    }
    return { id: { in: ids } };
  }
  async acquisitionVisible(id: string, value: string | null) {
    if (!value?.startsWith('CHAT_') && !value?.startsWith('AI_CHAT')) return true;
    const channel = chatSourceChannel(value);
    if (channel) {
      const company = (['SHOP', 'FINANCE'] as const).find((c) =>
        WORK_CHANNELS[c].includes(channel as ChatChannel),
      );
      if (company && this.company('chat.read', company)) return true;
    }
    return !!(await this.db.chatRoom.count({
      where: {
        customerId: id,
        ...(channel ? { channel: channel as ChatChannel } : {}),
        AND: this.room,
      },
    }));
  }
}

/** Finite vocabulary used by the canonical Customer query constructors. No caller can
 * supply this tree: DTO values are assembled by CustomerQueryService first. */
/** Finite vocabulary used by the canonical six-route filter constructors.
 * New relation fields fail closed until their contributor contract is reviewed. */
function scopedContributorFilter(
  plan: PartyQueryPlan,
  kind: 'contracts' | 'sales' | 'chatRooms' | 'creditChecks' | 'product',
  input: Record<string, unknown>,
): Record<string, unknown> {
  const fields = {
    contracts: ['deletedAt', 'status', 'branchId', 'createdAt', 'contractNumber'],
    sales: ['deletedAt', 'saleType', 'branchId', 'createdAt', 'saleNumber'],
    chatRooms: [
      'deletedAt',
      'channel',
      'displayName',
      'lastCustomerAt',
      'lastMessageAt',
      'assignedToId',
    ],
    creditChecks: ['deletedAt', 'status'],
    product: ['imeiSerial'],
  };
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      output[key] = (Array.isArray(value) ? value : [value]).map((node) =>
        scopedContributorFilter(plan, kind, node as Record<string, unknown>),
      );
    } else if (key === 'product' && (kind === 'contracts' || kind === 'sales')) {
      output.product = {
        AND: [
          plan.product,
          scopedContributorFilter(plan, 'product', value as Record<string, unknown>),
        ],
      };
    } else if (fields[kind].includes(key)) {
      assertScalarFilter(value);
      output[key] = value;
    } else throw new ForbiddenException('ไม่รองรับตัวกรองข้อมูลนี้');
  }
  return output;
}
function assertScalarFilter(value: unknown): void {
  if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date)
    return;
  if (Array.isArray(value)) {
    value.forEach(assertScalarFilter);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      ![
        'equals',
        'in',
        'notIn',
        'lt',
        'lte',
        'gt',
        'gte',
        'contains',
        'startsWith',
        'endsWith',
        'mode',
        'not',
      ].includes(key)
    )
      throw new ForbiddenException('ไม่รองรับตัวกรองข้อมูลนี้');
    assertScalarFilter(nested);
  }
}

export async function scopePartyCustomerWhere(
  plan: PartyQueryPlan,
  input: Prisma.CustomerWhereInput,
  contractMode: 'purchase' | 'finance' = 'purchase',
): Promise<Prisma.CustomerWhereInput> {
  const and: Prisma.CustomerWhereInput[] = [];
  const scalars = new Set([
    'id',
    'deletedAt',
    'name',
    'phone',
    'nickname',
    'createdAt',
    'mergedIntoId',
  ]);
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const values = Array.isArray(value) ? value : [value];
      and.push({
        [key]: await Promise.all(
          values.map((v) =>
            scopePartyCustomerWhere(plan, v as Prisma.CustomerWhereInput, contractMode),
          ),
        ),
      });
    } else if (scalars.has(key)) {
      assertScalarFilter(value);
      and.push({ [key]: value });
    } else if (key === 'nationalId')
      and.push(await plan.nationalIdMatches(value as Prisma.StringNullableFilter));
    else if (['contracts', 'sales', 'chatRooms', 'creditChecks'].includes(key)) {
      const predicate =
        key === 'contracts'
          ? contractMode === 'finance'
            ? plan.contract
            : plan.purchaseContract
          : key === 'sales'
            ? plan.sale
            : key === 'chatRooms'
              ? plan.room
              : plan.credit;
      const relation: Record<string, unknown> = {};
      for (const [quantifier, nested] of Object.entries(value as object)) {
        if (!['some', 'none', 'every'].includes(quantifier))
          throw new ForbiddenException('ไม่รองรับตัวกรองข้อมูลนี้');
        const child = scopedContributorFilter(
          plan,
          key as 'contracts' | 'sales' | 'chatRooms' | 'creditChecks',
          nested as Record<string, unknown>,
        );
        // every is implication: out-of-scope rows cannot invalidate the authorized set.
        relation[quantifier] =
          quantifier === 'every'
            ? { OR: [{ NOT: predicate }, child] }
            : { AND: [predicate, child] };
      }
      and.push({ [key]: relation });
    } else if (key === 'acquisitionSource') {
      assertScalarFilter(value);
      const candidates = await plan.db.customer.findMany({
        where: {
          AND: [plan.customer, { acquisitionSource: value as Prisma.StringNullableFilter }],
        },
        select: { id: true, acquisitionSource: true },
      });
      const ids: string[] = [];
      for (const row of candidates)
        if (await plan.acquisitionVisible(row.id, row.acquisitionSource)) ids.push(row.id);
      and.push({ id: { in: ids } });
    } else if (key === 'tags' || key === 'creditCheckStatus') {
      and.push(await plan.matchingDerived(key, value));
    } else if (key === 'referredById') {
      // A hidden referrer cannot influence a source classification.
      and.push({
        AND: [
          { referredById: value as Prisma.StringNullableFilter },
          { OR: [{ referredById: null }, { referredBy: plan.customer }] },
        ],
      });
    } else {
      // Tags and global denormalized credit require their explicit read plan; never
      // silently delegate a newly introduced contributor to unscoped Prisma.
      throw new ForbiddenException('ไม่รองรับตัวกรองข้อมูลนี้');
    }
  }
  return { AND: and };
}

const partyQueryContext = new AsyncLocalStorage<PartyQueryPlan>();
export function withPartyQuery<T>(plan: PartyQueryPlan, work: () => Promise<T>) {
  return partyQueryContext.run(plan, work);
}
export function currentPartyQuery(): PartyQueryPlan | undefined {
  const plan = partyQueryContext.getStore();
  if (plan && !isCurrentDomainClient(plan.db))
    throw new Error('Party query escaped its owned transaction');
  return plan;
}

export function assertPartyQueryClient(client: object): void {
  if (currentPartyQuery() && !isCurrentDomainClient(client))
    throw new Error('Party contributor query requires the exact owned client');
}
