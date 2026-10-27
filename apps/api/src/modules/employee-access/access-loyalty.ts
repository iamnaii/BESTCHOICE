import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccess } from '@installment/shared';
import { PartyQueryPlan } from './access-party-query-plan';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { permissionScopes } from './access-context';
import { saleSource } from './access-sales-scope';
import { loyaltyAccountAllows, verifiedLoyaltySale } from '../loyalty/loyalty-sale-proof';
import { RedeemPointsDto } from '../loyalty/dto/loyalty.dto';

const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลแต้มนี้');
/** Projection/verification over the existing party authority plan and canonical Sale proof.
 * Never reconstruct the global account or execute a second debit. */
export class ManagedLoyalty {
  private readonly ctx = currentDomainAccess()!;
  private constructor(
    readonly party: PartyQueryPlan,
    readonly customerId: string,
  ) {
    if (
      !this.ctx ||
      !isCurrentDomainClient(party.db) ||
      this.ctx.scopeReads ||
      this.ctx.isolationLevel !== 'Serializable'
    )
      throw unavailable();
  }
  static async create(
    party: PartyQueryPlan,
    sources: AccessPartySourceService,
    customerId: string,
    read: boolean,
  ) {
    const plan = new ManagedLoyalty(party, customerId);
    const ctx = plan.ctx;
    const identity = await sources.customer(party.db, customerId, true, false, true);
    await party.assertCustomer(customerId);
    if (
      read &&
      !identity.some(
        (source) =>
          source.company === ctx.scope.company &&
          sources.allows(ctx.snapshot, 'customers.read', source) &&
          sources.allows(ctx.snapshot, 'loyalty.read', source),
      )
    )
      throw unavailable();
    return plan;
  }
  private accountRead() {
    return (
      this.party.live.has('SHOP') && loyaltyAccountAllows(this.ctx.snapshot, 'loyalty.account.read')
    );
  }
  private async balance() {
    if (!this.accountRead()) return null;
    return (
      await this.party.db.customer.findUniqueOrThrow({
        where: { id: this.customerId },
        select: { loyaltyBalance: true },
      })
    ).loyaltyBalance;
  }
  private async historyPredicates() {
    const db = this.party.db,
      customerId = this.customerId;
    // Exact Payment -> Contract -> Customer correlation, independently scoped before
    // point counts/aggregates/limits. Pattern shared with PartyQueryPlan.receipts.
    await db.$queryRaw`SELECT p.id FROM payments p JOIN contracts c ON c.id=p.contract_id WHERE c.customer_id=${customerId} ORDER BY p.id FOR SHARE OF p`;
    const payments = await db.payment.findMany({
      where: { AND: this.party.payment, contract: { customerId, AND: this.party.contract } },
      select: { id: true, contractId: true },
    });
    const groups = new Map<string, string[]>();
    for (const p of payments) groups.set(p.contractId, [...(groups.get(p.contractId) ?? []), p.id]);
    const earned: Prisma.LoyaltyPointWhereInput = {
      customerId,
      deletedAt: null,
      OR: [...groups].map(([contractId, ids]) => ({ contractId, paymentId: { in: ids } })),
    };
    // Immutable proof validation precedes the final SQL counts/limits/aggregates.
    // Scan only independently readable Sale sources in bounded batches.
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.loyaltyRedemption.findMany({
        where: {
          customerId,
          deletedAt: null,
          saleId: { not: null },
          sale: { customerId, AND: this.party.sale },
        },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) if (await verifiedLoyaltySale(db, row)) ids.push(row.id);
      if (rows.length < 200) break;
      cursor = rows[rows.length - 1].id;
    }
    return {
      earned,
      redeemed: {
        customerId,
        deletedAt: null,
        id: { in: ids },
      } satisfies Prisma.LoyaltyRedemptionWhereInput,
    };
  }
  private availability() {
    return {
      earning: this.party.coverage('payments.read'),
      redemption: this.party.coverage('sales.read', 'SHOP'),
      coverage: 'visible-only' as const,
    };
  }
  async points() {
    const db = this.party.db,
      { earned, redeemed } = await this.historyPredicates();
    const [balance, e, r, referralCount] = await Promise.all([
      this.balance(),
      db.loyaltyPoint.aggregate({ where: earned, _sum: { points: true } }),
      db.loyaltyRedemption.aggregate({ where: redeemed, _sum: { points: true } }),
      db.customer.count({ where: { referredById: this.customerId, AND: this.party.customer } }),
    ]);
    return {
      customerId: this.customerId,
      balance,
      balanceAvailability: balance === null ? 'unavailable' : 'available',
      lifetimeEarned: null,
      lifetimeRedeemed: null,
      visibleEarned: e._sum.points ?? 0,
      visibleRedeemed: r._sum.points ?? 0,
      referralCount,
      referralCoverage: 'visible-only',
      historyAvailability: this.availability(),
      expiryAvailability: 'unavailable',
    };
  }
  async history(page = 1, limit = 20) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException('เลขหน้าหรือจำนวนรายการไม่ถูกต้อง');
    const db = this.party.db,
      { earned, redeemed } = await this.historyPredicates();
    const select = { id: true, points: true, contractId: true, createdAt: true } as const;
    const orderBy = [{ createdAt: 'desc' }, { id: 'asc' }] as const;
    const [e, r, ec, rc] = await Promise.all([
      db.loyaltyPoint.findMany({
        where: earned,
        select: { ...select, paymentId: true },
        orderBy: [...orderBy],
        take: page * limit,
      }),
      db.loyaltyRedemption.findMany({
        where: redeemed,
        select: { ...select, saleId: true },
        orderBy: [...orderBy],
        take: page * limit,
      }),
      db.loyaltyPoint.count({ where: earned }),
      db.loyaltyRedemption.count({ where: redeemed }),
    ]);
    const data = [
      ...e.map((row) => ({ ...row, type: 'EARN' as const, reason: 'PAYMENT' })),
      ...r.map((row) => ({ ...row, type: 'REDEEM' as const, reason: 'SALE' })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice((page - 1) * limit, page * limit);
    return {
      data,
      total: ec + rc,
      page,
      limit,
      coverage: 'visible-only',
      availability: this.availability(),
    };
  }
  async referrals() {
    const db = this.party.db;
    const complete =
      this.party.live.has('FINANCE') &&
      permissionScopes(
        { id: this.ctx.snapshot.userId, access: this.ctx.snapshot },
        'contracts.read',
        'FINANCE',
      ).some((t) => t.scope === 'COMPANY');
    const rows = await db.customer.findMany({
      where: { referredById: this.customerId, AND: this.party.customer },
      select: {
        id: true,
        name: true,
        createdAt: true,
        contracts: { where: this.party.contract, select: { id: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    // Even COMPANY grants cannot prove absence through an unavailable historical
    // origin. Only a genuinely absent active Contract is a negative answer.
    const referrals = await Promise.all(
      rows.map(async ({ contracts, ...row }) => ({
        ...row,
        hasContract: contracts.length
          ? true
          : complete &&
              !(await db.contract.count({ where: { customerId: row.id, deletedAt: null } }))
            ? false
            : null,
      })),
    );
    return {
      customerId: this.customerId,
      totalReferrals: referrals.length,
      coverage: 'visible-only',
      referralsWithContract: referrals.every((r) => r.hasContract !== null)
        ? referrals.filter((r) => r.hasContract).length
        : null,
      visibleReferralsWithContract: referrals.filter((r) => r.hasContract).length,
      totalPointsFromReferrals: null,
      referralPointsAvailability: 'unavailable',
      referrals,
    };
  }
  async verify(dto: RedeemPointsDto) {
    const db = this.party.db;
    const saleId = dto.saleId ?? dto.posTransactionId;
    if (
      !saleId ||
      (dto.saleId && dto.posTransactionId && dto.saleId !== dto.posTransactionId) ||
      dto.approverId !== undefined
    )
      throw unavailable();
    const source = await saleSource(db, saleId, true);
    if (
      !canAccess(this.ctx.snapshot, 'loyalty.update', source) ||
      !canAccess(this.ctx.snapshot, 'sales.read', source)
    )
      throw unavailable();
    const proof = await db.loyaltyRedemption.findUnique({ where: { saleId } });
    if (
      !proof ||
      proof.customerId !== this.customerId ||
      dto.amount !== proof.points ||
      (dto.contractId !== undefined && dto.contractId !== proof.contractId) ||
      !(await verifiedLoyaltySale(db, proof))
    )
      throw unavailable();
    // The immutable evidence remains internal; return only the exact verification receipt.
    return {
      status: 'VERIFIED',
      alreadyRedeemed: true,
      saleId,
      redemptionId: proof.id,
      redeemedPoints: proof.points,
      discountAmount: Number(proof.discountAmount),
      fingerprint: proof.fingerprint,
      newBalance: await this.balance(),
    };
  }
}
