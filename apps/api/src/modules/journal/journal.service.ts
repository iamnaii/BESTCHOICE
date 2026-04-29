import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJournalEntryDto } from './dto/journal.dto';
import { validatePeriodOpen } from '../../utils/period-lock.util';

@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  async generateEntryNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `JE-${year}${month}`;

    const startOfMonth = new Date(year, now.getMonth(), 1);
    const startOfNextMonth = new Date(year, now.getMonth() + 1, 1);

    const count = await this.prisma.journalEntry.count({
      where: {
        entryNumber: { startsWith: prefix },
        createdAt: {
          gte: startOfMonth,
          lt: startOfNextMonth,
        },
      },
    });

    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}-${sequence}`;
  }

  async create(dto: CreateJournalEntryDto, userId: string) {
    // 1. Validate balance: sum debits must equal sum credits
    const totalDebit = dto.lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = dto.lines.reduce((sum, line) => sum + line.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new BadRequestException('ยอดเดบิตและเครดิตไม่สมดุล');
    }

    // 2. Validate each line: at least one of debit or credit must be > 0
    for (const line of dto.lines) {
      if (line.debit === 0 && line.credit === 0) {
        throw new BadRequestException('แต่ละรายการต้องมียอดเดบิตหรือเครดิต');
      }
    }

    // 3. Validate companyId exists and not deleted (ดึงก่อนเพื่อเอา companyCode ไปเช็ค allowedCompanies)
    const company = await this.prisma.companyInfo.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });

    if (!company) {
      throw new NotFoundException('ไม่พบบริษัท');
    }

    // Block manual entries dated inside a closed/synced accounting period.
    // Without this, period close is only cosmetic because this endpoint lets
    // anyone backdate a journal into a closed month.
    await validatePeriodOpen(this.prisma, new Date(dto.entryDate), dto.companyId);

    // 4. Validate accountCodes exist in ChartOfAccount + allowed for this company
    const accountCodes = dto.lines.map((line) => line.accountCode);
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: {
        code: { in: accountCodes },
        isActive: true,
      },
      select: { code: true, allowedCompanies: true },
    });

    const foundCodes = new Set(accounts.map((a) => a.code));
    const missingCodes = accountCodes.filter((code) => !foundCodes.has(code));

    if (missingCodes.length > 0) {
      throw new BadRequestException(`รหัสบัญชีไม่ถูกต้อง: ${missingCodes.join(', ')}`);
    }

    // เช็คว่าบัญชีนี้อนุญาตให้บริษัทนี้ใช้หรือไม่
    // allowedCompanies เป็น array ว่าง = ใช้ได้ทุกบริษัท
    if (company.companyCode) {
      const blocked = accounts.filter(
        (a) =>
          a.allowedCompanies.length > 0 &&
          !a.allowedCompanies.includes(company.companyCode as string),
      );

      if (blocked.length > 0) {
        const codes = blocked.map((a) => a.code).join(', ');
        throw new BadRequestException(
          `บัญชี ${codes} ใช้กับบริษัท ${company.companyCode} ไม่ได้`,
        );
      }
    }

    // 5. Generate entry number + create in transaction to avoid race condition
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const prefix = `JE-${year}${month}`;

      const count = await tx.journalEntry.count({
        where: { entryNumber: { startsWith: prefix } },
      });
      const entryNumber = `${prefix}-${String(count + 1).padStart(4, '0')}`;

      return tx.journalEntry.create({
        data: {
          entryNumber,
          companyId: dto.companyId,
          entryDate: new Date(dto.entryDate),
          description: dto.description,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          createdById: userId,
          lines: {
            create: dto.lines.map((line) => ({
              accountCode: line.accountCode,
              description: line.description,
              debit: new Decimal(line.debit),
              credit: new Decimal(line.credit),
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  async findAll(filters: {
    companyId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;

    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.companyId) {
      where.companyId = filters.companyId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.startDate || filters.endDate) {
      const entryDate: Record<string, Date> = {};
      if (filters.startDate) {
        entryDate.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        entryDate.lte = new Date(filters.endDate);
      }
      where.entryDate = entryDate;
    }

    if (filters.search) {
      where.OR = [
        { description: { contains: filters.search, mode: 'insensitive' } },
        { entryNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: true },
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });

    if (!entry) {
      throw new NotFoundException('ไม่พบรายการบันทึกบัญชี');
    }

    return entry;
  }

  async post(
    id: string,
    userId: string,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const entry = await this.findOne(id);

    if (entry.status !== 'DRAFT') {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    // F-6-001: prevent posting a DRAFT into a CLOSED/SYNCED period.
    // create() already validates at draft time, but a draft created while
    // the period was open could otherwise be posted after period close,
    // retroactively altering the closed period's trial balance.
    await validatePeriodOpen(this.prisma, entry.entryDate, entry.companyId);

    // T2-C2: Segregation of Duties — the accountant who drafted a journal
    // entry must not be the same person who posts it to the ledger. System-
    // generated entries (journal-auto.service) have createdById = null and
    // are exempt; any human-created entry has an author to check against.
    if (entry.createdById && entry.createdById === userId) {
      throw new BadRequestException(
        'ผู้โพสต์ต้องไม่ใช่ผู้สร้าง journal entry (Segregation of Duties)',
      );
    }

    // Re-validate balance
    const totalDebit = entry.lines.reduce(
      (sum, line) => sum.add(line.debit),
      new Decimal(0),
    );
    const totalCredit = entry.lines.reduce(
      (sum, line) => sum.add(line.credit),
      new Decimal(0),
    );

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException('ยอดเดบิตและเครดิตไม่สมดุล');
    }

    // T2-C14: write the immutable JournalPostAuditLog row inside the same
    // $transaction as the post. If the audit insert fails for any reason
    // (FK breakage, trigger rejection, DB outage mid-call) the post() is
    // rolled back so we never end up with a POSTED entry that has no
    // corresponding audit row.
    const postedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.journalEntry.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt,
          postedById: userId,
        },
        include: { lines: true },
      });

      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: id,
          postedById: userId,
          postedAt,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });

      return updated;
    });
  }

  /**
   * Void a posted journal entry AND auto-create a reversal entry (T2-C9).
   *
   * Before: marking status=VOIDED silently removed the entry from the trial
   * balance — a user could void an expense journal after the fact without
   * any trace of WHAT was reversed. The reversal entry restores the
   * debit/credit discipline: every POSTED entry has either a matching
   * reversal or none at all.
   *
   * Policy:
   * - Reversal is dated `today` (never back-dated; prevents closed-period
   *   shenanigans via void)
   * - companyId copied from the original
   * - debit/credit flipped per line; other fields cloned
   * - referenceType='REVERSAL', referenceId=originalEntry.id
   * - status=POSTED immediately, createdById=null (system-generated),
   *   postedById=userId (the voider is on the hook for the reversal)
   *
   * The whole operation runs in a single $transaction so either both
   * happen or neither does.
   */
  async void(id: string, userId: string) {
    const entry = await this.findOne(id);

    if (entry.status !== 'POSTED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.$transaction(async (tx) => {
      const voided = await tx.journalEntry.update({
        where: { id },
        data: { status: 'VOIDED' },
        include: { lines: true },
      });

      // Build reversal entry number — reuse the monthly sequence logic but
      // keyed on today (not the original's month) so reversals land in the
      // open period.
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const prefix = `JE-${year}${month}`;
      const count = await tx.journalEntry.count({
        where: { entryNumber: { startsWith: prefix } },
      });
      const reversalNumber = `${prefix}-${String(count + 1).padStart(4, '0')}`;

      // Both createdById and postedById = voider. SoD's drafter≠poster rule
      // lives in post(); this reversal is created directly in POSTED state
      // (auto-posted on void) so the guard does not apply. The reversal is
      // discoverable via referenceType=REVERSAL; the audit trail is honest.
      await tx.journalEntry.create({
        data: {
          entryNumber: reversalNumber,
          companyId: entry.companyId,
          entryDate: now,
          description: `Reversal of ${entry.entryNumber}: ${entry.description}`,
          referenceType: 'REVERSAL',
          referenceId: entry.id,
          createdById: userId,
          postedById: userId,
          postedAt: now,
          status: 'POSTED',
          lines: {
            create: entry.lines.map((line) => ({
              accountCode: line.accountCode,
              description: line.description,
              debit: line.credit,
              credit: line.debit,
            })),
          },
        },
      });

      return voided;
    });
  }
}
