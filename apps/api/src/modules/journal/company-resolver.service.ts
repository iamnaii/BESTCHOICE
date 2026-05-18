import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P3-SP5 W3 — Centralised SHOP / FINANCE companyId lookup.
 *
 * Each SHOP template used to duplicate a per-instance `shopCompanyId` cache
 * + lookup helper (six identical copies plus a SHOP+FINANCE version inside
 * `PairedJournalService`). Three problems with that:
 *
 *  1. DRY — six copies of the same 10-line method.
 *  2. Staleness — the cache lived for the lifetime of the service instance
 *     and never invalidated. If a test wiped + reseeded CompanyInfo
 *     mid-suite the cached id would be stale and templates would post to a
 *     deleted company id.
 *  3. Test plumbing — every spec had to seed CompanyInfo just to satisfy
 *     the cache.
 *
 * This service is the single source of truth. No cache: the underlying
 * lookup is a single indexed `findFirst` (PK on companyCode), the cost is
 * negligible and avoiding the cache prevents stale-id bugs entirely.
 *
 * Templates inject this instead of holding their own private state. The
 * helper accepts an optional transaction client so it can participate in
 * the same `$transaction` as the calling template — this matters because
 * a SHOP template might run inside a Payment-level outer tx where the
 * CompanyInfo row could have been freshly seeded earlier in the tx.
 */
@Injectable()
export class CompanyResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async getShopCompanyId(tx?: Prisma.TransactionClient): Promise<string> {
    return this.resolve('SHOP', tx);
  }

  async getFinanceCompanyId(tx?: Prisma.TransactionClient): Promise<string> {
    return this.resolve('FINANCE', tx);
  }

  private async resolve(
    code: 'SHOP' | 'FINANCE',
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;
    const co = await client.companyInfo.findFirst({
      where: { companyCode: code, deletedAt: null },
      select: { id: true },
    });
    if (!co) {
      throw new BadRequestException(
        `${code} CompanyInfo not found — run seed:coa first`,
      );
    }
    return co.id;
  }
}
