import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OtherIncomeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from './services/doc-number.service';
import { ValidationService } from './services/validation.service';
import { AutoJournalService } from './services/auto-journal.service';
import { CreateOtherIncomeDto, OtherIncomeItemDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const ZERO = new D(0);

@Injectable()
export class OtherIncomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly validation: ValidationService,
    private readonly autoJournal: AutoJournalService,
  ) {}

  async create(dto: CreateOtherIncomeDto, userId: string) {
    const companyId = await this.resolveFinanceCompanyId();

    return this.prisma.$transaction(async (tx) => {
      const issueDate = new Date(dto.issueDate);
      const docNumber = await this.docNumber.nextDocNumber(tx, issueDate);
      const totals = this.computeTotals(dto);

      const codes = totals.items.map((it) => it.accountCode);
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameByCode = Object.fromEntries(coaRows.map((r) => [r.code, r.name]));
      const missingCoa = codes.filter((c) => !nameByCode[c]);
      if (missingCoa.length > 0) {
        throw new BadRequestException(
          `Account codes not found in ChartOfAccount: ${missingCoa.join(', ')}`,
        );
      }
      const itemsWithName = totals.items.map((it) => ({
        ...it,
        accountName: nameByCode[it.accountCode] ?? it.accountCode,
      }));

      return tx.otherIncome.create({
        data: {
          docNumber,
          companyId,
          status: OtherIncomeStatus.DRAFT,
          issueDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
          priceType: dto.priceType,
          customerId: dto.customerId ?? null,
          counterpartyName: dto.counterpartyName ?? null,
          counterpartyTaxId: dto.counterpartyTaxId ?? null,
          counterpartyAddress: dto.counterpartyAddress ?? null,
          counterpartyPhone: dto.counterpartyPhone ?? null,
          paymentAccountCode: dto.paymentAccountCode,
          amountReceived: new D(dto.amountReceived),
          incomeGross: totals.incomeGross,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          netReceived: totals.netReceived,
          totalAmount: totals.totalAmount,
          customerNote: dto.customerNote ?? null,
          createdById: userId,
          items: { create: itemsWithName },
          adjustments: dto.adjustments
            ? {
                create: dto.adjustments.map((a, i) => ({
                  lineNo: i + 1,
                  accountCode: a.accountCode,
                  amount: new D(a.amount),
                  note: a.note ?? null,
                })),
              }
            : undefined,
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  async update(id: string, dto: UpdateOtherIncomeDto, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${existing.docNumber} เป็น POSTED แล้ว ไม่สามารถแก้ไขได้ — ใช้ Reverse Entry`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.otherIncomeItem.deleteMany({ where: { otherIncomeId: id } });
      }
      if (dto.adjustments !== undefined) {
        await tx.otherIncomeAdjustment.deleteMany({ where: { otherIncomeId: id } });
      }

      const merged: CreateOtherIncomeDto = {
        issueDate: dto.issueDate ?? existing.issueDate.toISOString(),
        dueDate: dto.dueDate ?? existing.dueDate?.toISOString(),
        paymentDate: dto.paymentDate ?? existing.paymentDate?.toISOString(),
        priceType: dto.priceType ?? existing.priceType,
        paymentAccountCode: dto.paymentAccountCode ?? existing.paymentAccountCode,
        amountReceived: dto.amountReceived ?? Number(existing.amountReceived),
        items: (dto.items ??
          existing.items.map((i) => ({
            accountCode: i.accountCode,
            description: i.description ?? undefined,
            quantity: Number(i.quantity),
            unitAmount: Number(i.unitAmount),
            discountAmount: Number(i.discountAmount),
            vatPct: Number(i.vatPct),
            whtPct: Number(i.whtPct),
          }))) as OtherIncomeItemDto[],
        adjustments:
          dto.adjustments ??
          existing.adjustments?.map((a) => ({
            accountCode: a.accountCode,
            amount: Number(a.amount),
            note: a.note ?? undefined,
          })),
        customerId: dto.customerId ?? existing.customerId ?? undefined,
        counterpartyName: dto.counterpartyName ?? existing.counterpartyName ?? undefined,
        counterpartyTaxId: dto.counterpartyTaxId ?? existing.counterpartyTaxId ?? undefined,
        counterpartyAddress:
          dto.counterpartyAddress ?? existing.counterpartyAddress ?? undefined,
        counterpartyPhone: dto.counterpartyPhone ?? existing.counterpartyPhone ?? undefined,
        customerNote: dto.customerNote ?? existing.customerNote ?? undefined,
      };
      const totals = this.computeTotals(merged);

      // CoA name snapshot for new items
      let itemsWithName = totals.items;
      if (dto.items) {
        const codes = totals.items.map((it) => it.accountCode);
        const coaRows = await tx.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        });
        const nameByCode = Object.fromEntries(coaRows.map((r) => [r.code, r.name]));
        const missingCoa = codes.filter((c) => !nameByCode[c]);
        if (missingCoa.length > 0) {
          throw new BadRequestException(
            `Account codes not found in ChartOfAccount: ${missingCoa.join(', ')}`,
          );
        }
        itemsWithName = totals.items.map((it) => ({
          ...it,
          accountName: nameByCode[it.accountCode] ?? it.accountCode,
        }));
      }

      return tx.otherIncome.update({
        where: { id },
        data: {
          issueDate: new Date(merged.issueDate),
          dueDate: merged.dueDate ? new Date(merged.dueDate) : null,
          paymentDate: merged.paymentDate ? new Date(merged.paymentDate) : null,
          priceType: merged.priceType,
          paymentAccountCode: merged.paymentAccountCode,
          amountReceived: new D(merged.amountReceived),
          incomeGross: totals.incomeGross,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          netReceived: totals.netReceived,
          totalAmount: totals.totalAmount,
          customerId: merged.customerId ?? null,
          counterpartyName: merged.counterpartyName ?? null,
          counterpartyTaxId: merged.counterpartyTaxId ?? null,
          counterpartyAddress: merged.counterpartyAddress ?? null,
          counterpartyPhone: merged.counterpartyPhone ?? null,
          customerNote: merged.customerNote ?? null,
          items: dto.items ? { create: itemsWithName } : undefined,
          adjustments:
            dto.adjustments !== undefined
              ? {
                  create: (dto.adjustments ?? []).map((a, i) => ({
                    lineNo: i + 1,
                    accountCode: a.accountCode,
                    amount: new D(a.amount),
                    note: a.note ?? null,
                  })),
                }
              : undefined,
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(`เอกสาร POSTED/REVERSED ลบไม่ได้ — ใช้ Reverse Entry`);
    }
    return this.prisma.otherIncome.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findOneOrFail(id: string) {
    const doc = await this.prisma.otherIncome.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        adjustments: { orderBy: { lineNo: 'asc' } },
        attachments: true,
        customer: true,
      },
    });
    if (!doc) throw new NotFoundException(`OtherIncome ${id} not found`);
    return doc;
  }

  private async resolveFinanceCompanyId(): Promise<string> {
    const co = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!co) {
      throw new BadRequestException(
        'CompanyInfo with companyCode=FINANCE not found — seed accounting data first',
      );
    }
    return co.id;
  }

  private computeTotals(dto: CreateOtherIncomeDto) {
    const items = dto.items.map((it, i) => this.computeItem(it, dto.priceType, i + 1));
    const incomeGross = items.reduce<Decimal>((s, it) => s.plus(it.amountBeforeVat), ZERO);
    const vatAmount = items.reduce<Decimal>((s, it) => s.plus(it.vatAmount), ZERO);
    const whtAmount = items.reduce<Decimal>((s, it) => s.plus(it.whtAmount), ZERO);
    const totalAmount = incomeGross.plus(vatAmount);
    const netReceived = totalAmount.minus(whtAmount);

    return { items, incomeGross, vatAmount, whtAmount, totalAmount, netReceived };
  }

  private computeItem(
    it: OtherIncomeItemDto,
    priceType: 'EXCLUSIVE' | 'INCLUSIVE',
    lineNo: number,
  ) {
    const qty = new D(it.quantity);
    const unit = new D(it.unitAmount);
    const disc = new D(it.discountAmount ?? 0);
    const vatPct = new D(it.vatPct ?? 0);
    const whtPct = new D(it.whtPct ?? 0);

    const gross = qty.times(unit).minus(disc);
    let amountBeforeVat: Decimal;
    let vatAmount: Decimal;

    if (vatPct.gt(0)) {
      if (priceType === 'INCLUSIVE') {
        const factor = new D(1).plus(vatPct.div(100));
        amountBeforeVat = gross.div(factor).toDecimalPlaces(2);
        vatAmount = gross.minus(amountBeforeVat);
      } else {
        amountBeforeVat = gross;
        vatAmount = gross.times(vatPct).div(100).toDecimalPlaces(2);
      }
    } else {
      amountBeforeVat = gross;
      vatAmount = ZERO;
    }
    const whtAmount = amountBeforeVat.times(whtPct).div(100).toDecimalPlaces(2);

    return {
      lineNo,
      accountCode: it.accountCode,
      accountName: '',
      description: it.description ?? null,
      quantity: qty,
      unitAmount: unit,
      discountAmount: disc,
      vatPct,
      whtPct,
      amountBeforeVat,
      vatAmount,
      whtAmount,
    };
  }
}
