import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FinanceContactResult } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceContactLogDto,
  UpdateFinanceContactLogDto,
} from './dto/finance-receivable-contact-log.dto';
import { normalizeFinanceCompanyName } from './finance-company-name-normalizer.util';

@Injectable()
export class FinanceReceivableContactLogsService {
  constructor(private prisma: PrismaService) {}

  async record(
    receivableId: string,
    userId: string,
    dto: CreateFinanceContactLogDto,
  ) {
    const receivable = await this.prisma.financeReceivable.findFirst({
      where: { id: receivableId, deletedAt: null },
      select: {
        id: true,
        externalFinanceCompanyId: true,
        financeCompany: true,
        contactAttemptCount: true,
        lastPromisedDate: true,
      },
    });
    if (!receivable) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      let companyId = receivable.externalFinanceCompanyId;

      // D6: lazy resolve — upsert ExternalFinanceCompany if receivable has no FK yet
      if (!companyId) {
        const normalized = normalizeFinanceCompanyName(receivable.financeCompany);
        const company = await tx.externalFinanceCompany.upsert({
          where: { name: receivable.financeCompany },
          create: {
            name: receivable.financeCompany,
            isActive: true,
          },
          update: {},
        });
        companyId = company.id;
        await tx.financeReceivable.update({
          where: { id: receivableId },
          data: { externalFinanceCompanyId: companyId },
        });
        // suppress unused-var warning for `normalized` until backfill script reuses it
        void normalized;
      }

      const contactedAt = dto.contactedAt ? new Date(dto.contactedAt) : new Date();
      const log = await tx.financeReceivableContactLog.create({
        data: {
          financeReceivableId: receivableId,
          externalFinanceCompanyId: companyId!,
          financeCompanyContactId: dto.financeCompanyContactId,
          contactedById: userId,
          contactedAt,
          channel: dto.channel ?? 'CALL',
          result: dto.result,
          notes: dto.notes,
          promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : null,
          promisedAmount: dto.promisedAmount ?? null,
        },
      });

      // KPI denorm update — compute literal nextCount so tests can assert numeric value
      const nextLastPromised =
        dto.result === FinanceContactResult.PROMISED && dto.promisedDate
          ? new Date(dto.promisedDate)
          : receivable.lastPromisedDate;

      await tx.financeReceivable.update({
        where: { id: receivableId },
        data: {
          lastContactedAt: contactedAt,
          lastPromisedDate: nextLastPromised,
          contactAttemptCount: (receivable.contactAttemptCount ?? 0) + 1,
        },
      });

      return log;
    });
  }

  async list(receivableId: string) {
    return this.prisma.financeReceivableContactLog.findMany({
      where: { financeReceivableId: receivableId, deletedAt: null },
      orderBy: { contactedAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, position: true, phone: true } },
        contactedBy: { select: { id: true, name: true } },
      },
    });
  }

  async update(
    receivableId: string,
    logId: string,
    userId: string,
    userRole: string,
    dto: UpdateFinanceContactLogDto,
  ) {
    const log = await this.prisma.financeReceivableContactLog.findFirst({
      where: { id: logId, financeReceivableId: receivableId, deletedAt: null },
    });
    if (!log) throw new NotFoundException('ไม่พบบันทึกการติดต่อ');

    const isPrivileged = userRole === 'OWNER' || userRole === 'FINANCE_MANAGER';
    if (!isPrivileged) {
      if (log.contactedById !== userId) {
        throw new ForbiddenException('แก้ไขได้เฉพาะเจ้าของ log');
      }
      const ageMs = Date.now() - new Date(log.createdAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        throw new ForbiddenException('เกิน 24 ชั่วโมง ไม่สามารถแก้ไขได้');
      }
    }

    return this.prisma.financeReceivableContactLog.update({
      where: { id: logId },
      data: {
        notes: dto.notes,
        result: dto.result,
        channel: dto.channel,
        financeCompanyContactId: dto.financeCompanyContactId,
        promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : undefined,
        promisedAmount: dto.promisedAmount,
        contactedAt: dto.contactedAt ? new Date(dto.contactedAt) : undefined,
      },
    });
  }

  async softDelete(receivableId: string, logId: string) {
    const log = await this.prisma.financeReceivableContactLog.findFirst({
      where: { id: logId, financeReceivableId: receivableId, deletedAt: null },
    });
    if (!log) throw new NotFoundException('ไม่พบบันทึกการติดต่อ');

    await this.prisma.financeReceivableContactLog.update({
      where: { id: logId },
      data: { deletedAt: new Date() },
    });

    // Recompute KPI from remaining logs
    const remaining = await this.prisma.financeReceivableContactLog.findMany({
      where: { financeReceivableId: receivableId, deletedAt: null },
      orderBy: { contactedAt: 'desc' },
      take: 100,
    });
    const lastContactedAt = remaining[0]?.contactedAt ?? null;
    const lastPromised = remaining.find(
      (l) => l.result === 'PROMISED' && l.promisedDate,
    );
    await this.prisma.financeReceivable.update({
      where: { id: receivableId },
      data: {
        lastContactedAt,
        lastPromisedDate: lastPromised?.promisedDate ?? null,
        contactAttemptCount: remaining.length,
      },
    });
    return { ok: true };
  }

  async companyContactSummary(companyId: string) {
    const [receivableCount, totalOutstandingAgg, lastLog, brokenCount, keptCount] =
      await Promise.all([
        this.prisma.financeReceivable.count({
          where: { externalFinanceCompanyId: companyId, deletedAt: null },
        }),
        this.prisma.financeReceivable.aggregate({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            status: { in: ['PENDING', 'OVERDUE', 'DISPUTED', 'PARTIALLY_RECEIVED'] },
          },
          _sum: { netExpectedAmount: true, receivedAmount: true },
        }),
        this.prisma.financeReceivableContactLog.findFirst({
          where: { externalFinanceCompanyId: companyId, deletedAt: null },
          orderBy: { contactedAt: 'desc' },
          select: { contactedAt: true },
        }),
        this.prisma.financeReceivableContactLog.count({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            promisedBrokenAt: { not: null },
          },
        }),
        this.prisma.financeReceivableContactLog.count({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            promisedKeptAt: { not: null },
          },
        }),
      ]);

    return {
      receivableCount,
      totalOutstanding: totalOutstandingAgg._sum.netExpectedAmount ?? 0,
      lastContactedAt: lastLog?.contactedAt ?? null,
      brokenPromiseCount: brokenCount,
      keptPromiseCount: keptCount,
    };
  }

  async companyContactLogs(companyId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const [data, total] = await Promise.all([
      this.prisma.financeReceivableContactLog.findMany({
        where: { externalFinanceCompanyId: companyId, deletedAt: null },
        orderBy: { contactedAt: 'desc' },
        include: {
          receivable: { select: { id: true, financeRefNumber: true, expectedAmount: true } },
          contact: { select: { id: true, name: true, position: true } },
          contactedBy: { select: { id: true, name: true } },
        },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.financeReceivableContactLog.count({
        where: { externalFinanceCompanyId: companyId, deletedAt: null },
      }),
    ]);
    return { data, total, page: safePage, limit: safeLimit };
  }
}
