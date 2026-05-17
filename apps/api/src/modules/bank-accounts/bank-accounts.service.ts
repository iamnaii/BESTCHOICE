import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

/**
 * SP6 — BankAccountsService
 *
 * Provides a directory of cash + bank accounts (mirrors CoA codes 11-1101..1203)
 * together with their current balance computed from POSTED journal lines.
 *
 * Balance convention: cash + bank accounts are Dr-normal, so
 *   balance = SUM(debit) - SUM(credit)
 * Positive balance = cash on hand.
 */
@Injectable()
export class BankAccountsService {
  /** CoA prefixes that this module is allowed to manage (cash + bank assets). */
  private static readonly ALLOWED_CODE_PREFIXES = ['11-11', '11-12'];

  constructor(private readonly prisma: PrismaService) {}

  /** List all accounts (with balances) and optionally filter by active flag. */
  async findAll(options?: { activeOnly?: boolean }) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        deletedAt: null,
        ...(options?.activeOnly ? { isActive: true } : {}),
      },
      orderBy: { accountCode: 'asc' },
    });

    if (accounts.length === 0) return [];

    const balances = await this.computeBalances(accounts.map((a) => a.accountCode));
    return accounts.map((acc) => ({
      ...acc,
      balance: balances.get(acc.accountCode) ?? '0.00',
    }));
  }

  /** Single account + balance + recent 10 transactions. */
  async findByCode(accountCode: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { accountCode, deletedAt: null },
    });
    if (!account) throw new NotFoundException('ไม่พบบัญชีธนาคาร');

    const [balanceMap, recentLines] = await Promise.all([
      this.computeBalances([accountCode]),
      this.prisma.journalLine.findMany({
        where: {
          accountCode,
          deletedAt: null,
          journalEntry: { status: 'POSTED', deletedAt: null },
        },
        orderBy: { journalEntry: { entryDate: 'desc' } },
        take: 10,
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              referenceType: true,
              referenceId: true,
            },
          },
        },
      }),
    ]);

    return {
      ...account,
      balance: balanceMap.get(accountCode) ?? '0.00',
      recentTransactions: recentLines,
    };
  }

  /** Paginated journal lines for one account, newest first. */
  async getTransactions(accountCode: string, page = 1, limit = 50) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));

    // Make sure the account exists (404 before paging).
    const account = await this.prisma.bankAccount.findFirst({
      where: { accountCode, deletedAt: null },
      select: { accountCode: true },
    });
    if (!account) throw new NotFoundException('ไม่พบบัญชีธนาคาร');

    const where: Prisma.JournalLineWhereInput = {
      accountCode,
      deletedAt: null,
      journalEntry: { status: 'POSTED', deletedAt: null },
    };

    const [total, lines] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.findMany({
        where,
        orderBy: { journalEntry: { entryDate: 'desc' } },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              referenceType: true,
              referenceId: true,
            },
          },
        },
      }),
    ]);

    return { data: lines, total, page: pageNum, limit: limitNum };
  }

  /** Create a new bank account row. The CoA code must already exist and be cash/bank. */
  async create(dto: CreateBankAccountDto, _userId: string) {
    await this.assertCoaIsCashOrBank(dto.accountCode);

    const duplicate = await this.prisma.bankAccount.findUnique({
      where: { accountCode: dto.accountCode },
    });
    if (duplicate) {
      throw new ConflictException(`มีบัญชีรหัส ${dto.accountCode} อยู่แล้ว`);
    }

    return this.prisma.bankAccount.create({
      data: {
        accountCode: dto.accountCode,
        accountName: dto.accountName,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber ?? null,
        accountType: dto.accountType ?? 'SAVINGS',
        currency: dto.currency ?? 'THB',
        isActive: dto.isActive ?? true,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(accountCode: string, dto: UpdateBankAccountDto, _userId: string) {
    const existing = await this.prisma.bankAccount.findFirst({
      where: { accountCode, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบบัญชีธนาคาร');

    const data: Prisma.BankAccountUpdateInput = {};
    if (dto.accountName !== undefined) data.accountName = dto.accountName;
    if (dto.bankName !== undefined) data.bankName = dto.bankName;
    if (dto.accountNumber !== undefined) data.accountNumber = dto.accountNumber;
    if (dto.accountType !== undefined) data.accountType = dto.accountType;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.bankAccount.update({
      where: { id: existing.id },
      data,
    });
  }

  /** Soft-delete + flip isActive=false. */
  async disable(accountCode: string, _userId: string) {
    const existing = await this.prisma.bankAccount.findFirst({
      where: { accountCode, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบบัญชีธนาคาร');

    return this.prisma.bankAccount.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // ---------- internals ----------

  /** Sum debits/credits per code over POSTED entries. Returns Decimal-as-string map. */
  private async computeBalances(codes: string[]): Promise<Map<string, string>> {
    const grouped = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: codes },
        deletedAt: null,
        journalEntry: { status: 'POSTED', deletedAt: null },
      },
      _sum: { debit: true, credit: true },
    });

    const map = new Map<string, string>();
    for (const row of grouped) {
      const debit = (row._sum.debit ?? new Prisma.Decimal(0)) as Prisma.Decimal;
      const credit = (row._sum.credit ?? new Prisma.Decimal(0)) as Prisma.Decimal;
      const balance = new Prisma.Decimal(debit).minus(credit);
      map.set(row.accountCode, balance.toFixed(2));
    }
    // Ensure every requested code gets a value (zero if no rows).
    for (const c of codes) {
      if (!map.has(c)) map.set(c, '0.00');
    }
    return map;
  }

  private async assertCoaIsCashOrBank(code: string) {
    const ok = BankAccountsService.ALLOWED_CODE_PREFIXES.some((p) => code.startsWith(p));
    if (!ok) {
      throw new BadRequestException(
        `รหัสบัญชี ${code} ไม่ใช่บัญชีเงินสด/ธนาคาร (ต้องขึ้นต้นด้วย 11-11 หรือ 11-12)`,
      );
    }
    const coa = await this.prisma.chartOfAccount.findUnique({ where: { code } });
    if (!coa || coa.deletedAt) {
      throw new BadRequestException(`ไม่พบรหัสบัญชี ${code} ในผังบัญชี`);
    }
  }
}
