import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { SettleIntercompanyDto } from './dto/settle-intercompany.dto';

@Injectable()
export class IntercompanyService {
  private readonly logger = new Logger(IntercompanyService.name);

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
   *
   * SP2 — when called with `transactionId`, posts a real JE on the FINANCE
   * ledger and marks the InterCompanyTransaction as RECONCILED:
   *
   *   Dr 21-1101 [principal]                  เจ้าหนี้-หน้าร้าน (ยอดจัด)
   *   Dr 21-1102 [commission]                 เจ้าหนี้ค่าคอม-หน้าร้าน
   *      Cr <depositAccountCode> [total]      เงินสด/ธนาคารที่ใช้จ่าย
   *
   * Idempotent: rejects if the txn is already RECONCILED.
   * Atomic: JE post + status update happen in one $transaction.
   *
   * Legacy mode (no transactionId, just amount+reference) is retained for
   * backward compatibility — it skips JE posting, mirroring the prior
   * Phase A.4 behavior so existing callers (which already posted SHOP-side
   * JEs elsewhere) don't double-book.
   */
  async settle(dto: SettleIntercompanyDto, _userId: string) {
    // Pre-flight: settlement amount cannot exceed current outstanding.
    const balance = await this.getOutstandingBalance();
    if (dto.amount > balance.financeOwesToShop + 0.01) {
      throw new BadRequestException(
        `จำนวนชำระเกินยอดที่ค้าง (ค้าง ${balance.financeOwesToShop.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท)`,
      );
    }

    // SP2: full settlement path — JE post + InterCompanyTransaction status update
    if (dto.transactionId) {
      return this.settleWithJournal(dto, balance);
    }

    // Legacy path (Phase A.4 behavior) — kept for backward compat
    this.logger.warn(
      `[Phase A.4 legacy] Inter-company settlement JE skipped for ref ${dto.reference} — caller did not pass transactionId`,
    );
    return {
      amount: dto.amount,
      reference: dto.reference,
      remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
    };
  }

  /**
   * SP2: post settlement JE + update InterCompanyTransaction in one tx.
   */
  private async settleWithJournal(
    dto: SettleIntercompanyDto,
    balance: { financeOwesToShop: number },
  ) {
    const transactionId = dto.transactionId!;
    const depositAccountCode = dto.depositAccountCode ?? '11-1201';

    return this.prisma.$transaction(async (tx) => {
      const txn = await tx.interCompanyTransaction.findFirst({
        where: { id: transactionId, deletedAt: null },
        select: {
          id: true,
          status: true,
          principal: true,
          commission: true,
          totalAmount: true,
          journalEntryId: true,
        },
      });
      if (!txn) {
        throw new NotFoundException(`ไม่พบรายการ Inter-Company id=${transactionId}`);
      }
      if (txn.status === 'RECONCILED' || txn.journalEntryId) {
        throw new ConflictException('รายการนี้ถูกจ่ายและบันทึกบัญชีไปแล้ว');
      }

      const principal = new Decimal(txn.principal.toString());
      const commission = new Decimal(txn.commission.toString());
      const expectedTotal = principal.plus(commission);
      const inputAmount = new Decimal(dto.amount);
      // Allow 1 satang rounding tolerance
      if (inputAmount.minus(expectedTotal).abs().gt(new Decimal('0.01'))) {
        throw new BadRequestException(
          `จำนวนเงินที่จ่าย ${inputAmount.toFixed(2)} ไม่ตรงกับยอดในรายการ (${expectedTotal.toFixed(2)})`,
        );
      }

      const postedAt = dto.paidDate ? new Date(dto.paidDate) : new Date();

      const lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal; description?: string }> =
        [];
      if (principal.gt(0)) {
        lines.push({
          accountCode: '21-1101',
          dr: principal,
          cr: new Decimal(0),
          description: 'ล้างเจ้าหนี้-หน้าร้าน (Inter-co settlement)',
        });
      }
      if (commission.gt(0)) {
        lines.push({
          accountCode: '21-1102',
          dr: commission,
          cr: new Decimal(0),
          description: 'ล้างเจ้าหนี้ค่าคอม-หน้าร้าน (Inter-co settlement)',
        });
      }
      lines.push({
        accountCode: depositAccountCode,
        dr: new Decimal(0),
        cr: expectedTotal,
        description: `จ่ายค่าจัด+ค่าคอม Inter-co ref ${dto.reference}`,
      });

      const je = await this.journalAuto.createAndPost(
        {
          description: `Inter-co settlement ${dto.reference}`,
          reference: `${transactionId}:inter-company-settlement`,
          postedAt,
          metadata: {
            flow: 'inter-company-settlement',
            interCompanyTransactionId: transactionId,
            reference: dto.reference,
            principal: principal.toFixed(2),
            commission: commission.toFixed(2),
            depositAccountCode,
          },
          lines,
        },
        tx,
      );

      // Override referenceType to INTER_COMPANY for clarity in reports
      await tx.journalEntry.update({
        where: { id: je.id },
        data: { referenceType: 'INTER_COMPANY', referenceId: transactionId },
      });

      await tx.interCompanyTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'RECONCILED',
          reconciledAt: postedAt,
          journalEntryId: je.id,
        },
      });

      const remainingBalance = Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100;

      return {
        amount: dto.amount,
        reference: dto.reference,
        transactionId,
        journalEntryId: je.id,
        entryNumber: je.entryNumber,
        remainingBalance,
      };
    });
  }
}
