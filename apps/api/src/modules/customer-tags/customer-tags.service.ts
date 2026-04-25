import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CustomerTag, CustomerTagSource, CustomerTagType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Customer tag service — both auto-tag rules (cron + manual recompute) and
 * manual override (OWNER / FINANCE_MANAGER apply/remove BLACKLIST etc.).
 *
 * Tag rules (auto):
 *  - VIP        : ≥3 contracts AND zero BROKEN_PROMISE in last 12 months
 *  - HIGH_RISK  : ≥3 BROKEN_PROMISE in last 90 days
 *  - NEW        : first contract createdAt < 30 days ago (no other contracts older)
 *  - LOYAL      : customer createdAt > 2 years AND zero BROKEN_PROMISE lifetime
 *  - BLACKLIST  : MANUAL ONLY — never auto-applied
 *
 * Soft-delete with `(customerId, tag, deletedAt)` unique constraint means a
 * re-application of an already active tag is a no-op (returns the existing
 * row) rather than colliding with the unique index. Re-applying after a soft
 * delete creates a fresh row.
 */
@Injectable()
export class CustomerTagsService {
  private readonly logger = new Logger(CustomerTagsService.name);

  // Auto-tag thresholds
  private static readonly VIP_MIN_CONTRACTS = 3;
  private static readonly VIP_LOOKBACK_MONTHS = 12;
  private static readonly HIGH_RISK_BROKEN_PROMISES = 3;
  private static readonly HIGH_RISK_LOOKBACK_DAYS = 90;
  private static readonly NEW_LOOKBACK_DAYS = 30;
  private static readonly LOYAL_MIN_AGE_DAYS = 365 * 2;

  // Tags managed by the auto-recompute. BLACKLIST is intentionally omitted —
  // it stays untouched by recompute so MANUAL applications survive.
  private static readonly AUTO_MANAGED_TAGS: CustomerTagType[] = [
    'VIP',
    'HIGH_RISK',
    'NEW',
    'LOYAL',
  ];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply a tag to a customer. Idempotent: re-applying an already-active tag
   * returns the existing row. Re-applying after soft delete creates a new row.
   */
  async applyTag(
    customerId: string,
    tag: CustomerTagType,
    source: CustomerTagSource,
    reason?: string,
    userId?: string,
  ): Promise<CustomerTag> {
    const existing = await this.prisma.customerTag.findFirst({
      where: { customerId, tag, deletedAt: null },
    });
    if (existing) return existing;

    return this.prisma.customerTag.create({
      data: {
        customerId,
        tag,
        source,
        reason: reason ?? null,
        appliedByUserId: userId ?? null,
      },
    });
  }

  /**
   * Soft-delete the active tag row for (customerId, tag). No-op if not present.
   */
  async removeTag(
    customerId: string,
    tag: CustomerTagType,
    _userId: string,
  ): Promise<{ removed: number }> {
    const result = await this.prisma.customerTag.updateMany({
      where: { customerId, tag, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { removed: result.count };
  }

  /**
   * Soft-delete a tag by id (for the DELETE /customer-tags/:id endpoint).
   * Throws NotFound if the tag does not exist or is already soft-deleted.
   */
  async removeById(id: string, _userId: string): Promise<{ removed: number }> {
    const tag = await this.prisma.customerTag.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tag) throw new NotFoundException('ไม่พบ tag นี้');
    await this.prisma.customerTag.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { removed: 1 };
  }

  async listForCustomer(customerId: string): Promise<CustomerTag[]> {
    return this.prisma.customerTag.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Re-evaluate auto-tag rules for a single customer. Adds tags whose
   * conditions are met, soft-deletes auto-applied tags whose conditions are no
   * longer met. MANUAL tags (and BLACKLIST specifically) are never touched.
   */
  async recomputeForCustomer(customerId: string): Promise<{
    added: CustomerTagType[];
    removed: CustomerTagType[];
  }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, createdAt: true },
    });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้านี้');

    const desired = await this.evaluateAutoTags(customer.id, customer.createdAt);

    const existing = await this.prisma.customerTag.findMany({
      where: {
        customerId,
        deletedAt: null,
        tag: { in: CustomerTagsService.AUTO_MANAGED_TAGS },
        source: 'AUTO',
      },
    });
    const existingTags = new Set(existing.map((t) => t.tag));

    const added: CustomerTagType[] = [];
    for (const tag of desired) {
      if (!existingTags.has(tag)) {
        await this.applyTag(customerId, tag, 'AUTO', this.autoReason(tag));
        added.push(tag);
      }
    }

    const desiredSet = new Set(desired);
    const removed: CustomerTagType[] = [];
    for (const row of existing) {
      if (!desiredSet.has(row.tag)) {
        await this.prisma.customerTag.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
        removed.push(row.tag);
      }
    }

    return { added, removed };
  }

  /**
   * Cron entry-point. Iterates over all non-deleted customers and recomputes.
   * For 10k+ customers this is run-of-the-mill (a few seconds); when scaling
   * higher, batch by createdAt window.
   */
  async recomputeAll(): Promise<{ processed: number; added: number; removed: number }> {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, createdAt: true },
    });

    let added = 0;
    let removed = 0;
    for (const c of customers) {
      try {
        const desired = await this.evaluateAutoTags(c.id, c.createdAt);

        const existing = await this.prisma.customerTag.findMany({
          where: {
            customerId: c.id,
            deletedAt: null,
            tag: { in: CustomerTagsService.AUTO_MANAGED_TAGS },
            source: 'AUTO',
          },
        });
        const existingTags = new Set(existing.map((t) => t.tag));

        for (const tag of desired) {
          if (!existingTags.has(tag)) {
            await this.applyTag(c.id, tag, 'AUTO', this.autoReason(tag));
            added++;
          }
        }
        const desiredSet = new Set(desired);
        for (const row of existing) {
          if (!desiredSet.has(row.tag)) {
            await this.prisma.customerTag.update({
              where: { id: row.id },
              data: { deletedAt: new Date() },
            });
            removed++;
          }
        }
      } catch (err) {
        this.logger.warn(
          `recomputeAll: skip customer ${c.id} — ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { processed: customers.length, added, removed };
  }

  /**
   * Evaluate which auto-managed tags should be present for a customer right
   * now. BLACKLIST is intentionally not part of this — it stays manual-only.
   */
  private async evaluateAutoTags(
    customerId: string,
    customerCreatedAt: Date,
  ): Promise<CustomerTagType[]> {
    const now = new Date();

    const contractCount = await this.prisma.contract.count({
      where: { customerId, deletedAt: null },
    });

    const firstContract = await this.prisma.contract.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const contractIds = (
      await this.prisma.contract.findMany({
        where: { customerId, deletedAt: null },
        select: { id: true },
      })
    ).map((c) => c.id);

    const brokenPromiseLifetime =
      contractIds.length === 0
        ? 0
        : await this.prisma.auditLog.count({
            where: {
              entity: 'Contract',
              entityId: { in: contractIds },
              action: 'BROKEN_PROMISE',
            },
          });

    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - CustomerTagsService.VIP_LOOKBACK_MONTHS);
    const brokenPromise12mo =
      contractIds.length === 0
        ? 0
        : await this.prisma.auditLog.count({
            where: {
              entity: 'Contract',
              entityId: { in: contractIds },
              action: 'BROKEN_PROMISE',
              createdAt: { gte: twelveMonthsAgo },
            },
          });

    const ninetyDaysAgo = new Date(
      now.getTime() - CustomerTagsService.HIGH_RISK_LOOKBACK_DAYS * 86400000,
    );
    const brokenPromise90d =
      contractIds.length === 0
        ? 0
        : await this.prisma.auditLog.count({
            where: {
              entity: 'Contract',
              entityId: { in: contractIds },
              action: 'BROKEN_PROMISE',
              createdAt: { gte: ninetyDaysAgo },
            },
          });

    const newCutoff = new Date(now.getTime() - CustomerTagsService.NEW_LOOKBACK_DAYS * 86400000);
    const loyalCutoff = new Date(
      now.getTime() - CustomerTagsService.LOYAL_MIN_AGE_DAYS * 86400000,
    );

    const tags: CustomerTagType[] = [];

    if (contractCount >= CustomerTagsService.VIP_MIN_CONTRACTS && brokenPromise12mo === 0) {
      tags.push('VIP');
    }
    if (brokenPromise90d >= CustomerTagsService.HIGH_RISK_BROKEN_PROMISES) {
      tags.push('HIGH_RISK');
    }
    if (
      firstContract &&
      firstContract.createdAt >= newCutoff &&
      contractCount === 1
    ) {
      tags.push('NEW');
    }
    if (customerCreatedAt < loyalCutoff && brokenPromiseLifetime === 0) {
      tags.push('LOYAL');
    }

    return tags;
  }

  private autoReason(tag: CustomerTagType): string {
    switch (tag) {
      case 'VIP':
        return 'AUTO: ≥3 สัญญา และไม่ผิดนัดใน 12 เดือนหลัง';
      case 'HIGH_RISK':
        return 'AUTO: ผิดนัด ≥3 ครั้งใน 90 วันหลัง';
      case 'NEW':
        return 'AUTO: ลูกค้าสัญญาแรกอายุ <30 วัน';
      case 'LOYAL':
        return 'AUTO: เป็นลูกค้ามา >2 ปี และไม่เคยผิดนัด';
      case 'BLACKLIST':
        // Should never happen — BLACKLIST is MANUAL-only.
        throw new BadRequestException('BLACKLIST ไม่สามารถ apply โดยอัตโนมัติได้');
    }
  }
}
