import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { SettleIntercompanyDto } from './dto/settle-intercompany.dto';

@Injectable()
export class IntercompanyService {
  constructor(
    private prisma: PrismaService,
    private journalAuto: JournalAutoService,
  ) {}

  /**
   * Compute current outstanding inter-company balance.
   * - financeOwesToShop: net Cr balance on FINANCE 21-1102 (Due-to-SHOP)
   * - shopReceivableFromFinance: net Dr balance on SHOP 11-2105 (Due-from-FINANCE)
   *
   * The two should always match (IC invariant). Returns both for cross-check.
   */
  async getOutstandingBalance(): Promise<{
    financeOwesToShop: number;
    shopReceivableFromFinance: number;
    balanced: boolean;
    drift: number;
  }> {
    const [shop, finance] = await Promise.all([
      this.prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }),
      this.prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }),
    ]);
    if (!shop || !finance) {
      throw new InternalServerErrorException('SHOP or FINANCE company not configured');
    }

    const [shopAgg, financeAgg] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: {
          deletedAt: null,
          accountCode: '11-2105',
          journalEntry: { companyId: shop.id, status: 'POSTED', deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.aggregate({
        where: {
          deletedAt: null,
          accountCode: '21-1102',
          journalEntry: { companyId: finance.id, status: 'POSTED', deletedAt: null },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const shopReceivableFromFinance = new Prisma.Decimal(shopAgg._sum.debit ?? 0)
      .sub(shopAgg._sum.credit ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    const financeOwesToShop = new Prisma.Decimal(financeAgg._sum.credit ?? 0)
      .sub(financeAgg._sum.debit ?? 0)
      .toDecimalPlaces(2)
      .toNumber();

    const drift = Math.round((shopReceivableFromFinance - financeOwesToShop) * 100) / 100;

    return {
      financeOwesToShop,
      shopReceivableFromFinance,
      balanced: Math.abs(drift) < 0.01,
      drift,
    };
  }

  /**
   * Record an inter-company settlement (FINANCE pays SHOP).
   * Posts paired SHOP+FINANCE JEs in a single transaction.
   */
  async settle(dto: SettleIntercompanyDto, userId: string) {
    // Pre-flight: settlement amount cannot exceed current outstanding.
    const balance = await this.getOutstandingBalance();
    if (dto.amount > balance.financeOwesToShop + 0.01) {
      throw new BadRequestException(
        `จำนวนชำระเกินยอดที่ค้าง (ค้าง ${balance.financeOwesToShop.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.journalAuto.createInterCompanySettlementJournal(tx, {
        amount: dto.amount,
        reference: dto.reference,
        notes: dto.notes,
        paidDate: dto.paidDate ? new Date(dto.paidDate) : null,
        userId,
      });
    });

    return {
      ...result,
      amount: dto.amount,
      reference: dto.reference,
      remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
    };
  }
}
