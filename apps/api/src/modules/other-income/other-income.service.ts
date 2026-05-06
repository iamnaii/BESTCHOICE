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
import { OtherIncomeTemplate } from './templates/other-income.template';
import { CreateOtherIncomeDto, OtherIncomeItemDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { ListOtherIncomeQueryDto } from './dto/list-other-income-query.dto';
import { validatePeriodOpen } from '../../utils/period-lock.util';

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
    private readonly template: OtherIncomeTemplate,
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

  // -------------------------------------------------------------------------
  // post(): DRAFT → POSTED
  // -------------------------------------------------------------------------

  async post(id: string, dto: PostOtherIncomeDto, userId: string) {
    const doc = await this.findOneOrFail(id);
    if (doc.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ไม่สามารถ POST ซ้ำได้`,
      );
    }

    // V8: period lock check (non-transactional pre-check)
    await validatePeriodOpen(this.prisma, doc.issueDate);

    // Compute attachment threshold
    const threshold = await this.getAttachmentThreshold();
    const hasAttachment = doc.attachments.length > 0;

    // Build validation doc shape from existing model
    const validationDoc = {
      issueDate: doc.issueDate,
      paymentAccountCode: doc.paymentAccountCode,
      amountReceived: new D(doc.amountReceived.toString()),
      netReceived: new D(doc.netReceived.toString()),
      items: doc.items.map((it) => ({
        lineNo: it.lineNo,
        accountCode: it.accountCode,
        vatPct: new D(it.vatPct.toString()),
        whtPct: new D(it.whtPct.toString()),
        amountBeforeVat: new D(it.amountBeforeVat.toString()),
        vatAmount: new D(it.vatAmount.toString()),
        whtAmount: new D(it.whtAmount.toString()),
      })),
      adjustments: doc.adjustments.map((a) => ({
        lineNo: a.lineNo,
        accountCode: a.accountCode,
        amount: new D(a.amount.toString()),
      })),
    };

    const { errors } = this.validation.validate(validationDoc, {
      isPeriodOpen: () => true, // period already checked by validatePeriodOpen above
      attachmentThreshold: threshold,
      hasAttachment,
    });

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'ไม่ผ่านการตรวจสอบก่อน POST', errors });
    }

    // Generate or use override JE lines
    let jeLines;
    if (dto.override && dto.overrideLines && dto.overrideLines.length > 0) {
      jeLines = dto.overrideLines.map((l) => ({
        accountCode: l.accountCode,
        debit: new D(l.debit),
        credit: new D(l.credit),
        description: l.description,
      }));
    } else {
      jeLines = this.autoJournal.generate({
        paymentAccountCode: doc.paymentAccountCode,
        amountReceived: new D(doc.amountReceived.toString()),
        netReceived: new D(doc.netReceived.toString()),
        items: doc.items.map((it) => ({
          lineNo: it.lineNo,
          accountCode: it.accountCode,
          accountName: it.accountName,
          description: it.description ?? undefined,
          amountBeforeVat: new D(it.amountBeforeVat.toString()),
          vatAmount: new D(it.vatAmount.toString()),
          whtAmount: new D(it.whtAmount.toString()),
          whtPct: new D(it.whtPct.toString()),
        })),
        adjustments: doc.adjustments.map((a) => ({
          lineNo: a.lineNo,
          accountCode: a.accountCode,
          amount: new D(a.amount.toString()),
          note: a.note ?? undefined,
        })),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const receiptNo = await this.docNumber.nextReceiptNumber(tx, doc.issueDate);
      const now = new Date();

      const je = await this.template.post(
        {
          description: `รายได้อื่น ${doc.docNumber}${doc.counterpartyName ? ` — ${doc.counterpartyName}` : ''}`,
          entryDate: doc.issueDate,
          otherIncomeId: doc.id,
          docNumber: doc.docNumber,
          lines: jeLines,
        },
        tx,
      );

      return tx.otherIncome.update({
        where: { id },
        data: {
          status: OtherIncomeStatus.POSTED,
          receiptNo,
          journalEntryId: je.id,
          isOverridden: !!(dto.override && dto.overrideLines && dto.overrideLines.length > 0),
          postedAt: now,
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  // -------------------------------------------------------------------------
  // reverse(): POSTED → create -R reversal doc, mark original REVERSED
  // -------------------------------------------------------------------------

  async reverse(id: string, dto: ReverseOtherIncomeDto, userId: string) {
    const original = await this.findOneOrFail(id);
    if (original.status !== OtherIncomeStatus.POSTED) {
      throw new ConflictException(
        `เอกสาร ${original.docNumber} สถานะ ${original.status} — สามารถ Reverse ได้เฉพาะ POSTED`,
      );
    }

    // Period lock on original's issue date
    await validatePeriodOpen(this.prisma, original.issueDate);

    // Load original JE lines
    if (!original.journalEntryId) {
      throw new BadRequestException(`เอกสาร ${original.docNumber} ไม่มี JE reference`);
    }

    const originalJe = await this.prisma.journalEntry.findUnique({
      where: { id: original.journalEntryId },
      include: { lines: true },
    });
    if (!originalJe) {
      throw new NotFoundException(`JE ${original.journalEntryId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const issueDate = new Date();
      const reverseDocNumber = await this.docNumber.nextDocNumber(tx, issueDate);
      const receiptNo = await this.docNumber.nextReceiptNumber(tx, issueDate);
      const now = new Date();

      // Flip Dr/Cr from original JE lines
      const reversalLines = originalJe.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: new D(l.credit.toString()),
        credit: new D(l.debit.toString()),
        description: l.description ? `[กลับรายการ] ${l.description}` : '[กลับรายการ]',
      }));

      const reverseJe = await this.template.post(
        {
          description: `กลับรายการ ${original.docNumber} — ${dto.reason}: ${dto.note}`,
          entryDate: issueDate,
          // Use distinct reversal ID to avoid unique constraint on (reference_type, reference_id)
          otherIncomeId: `${id}:reversal`,
          docNumber: reverseDocNumber,
          lines: reversalLines,
        },
        tx,
      );

      // Create the -R OtherIncome doc (mirrored with negated amounts)
      const reversalDoc = await tx.otherIncome.create({
        data: {
          docNumber: reverseDocNumber,
          companyId: original.companyId,
          status: OtherIncomeStatus.POSTED,
          issueDate,
          dueDate: null,
          paymentDate: null,
          priceType: original.priceType,
          customerId: original.customerId ?? null,
          counterpartyName: original.counterpartyName ?? null,
          counterpartyTaxId: original.counterpartyTaxId ?? null,
          counterpartyAddress: original.counterpartyAddress ?? null,
          counterpartyPhone: original.counterpartyPhone ?? null,
          paymentAccountCode: original.paymentAccountCode,
          amountReceived: new D(original.amountReceived.toString()).negated(),
          incomeGross: new D(original.incomeGross.toString()).negated(),
          vatAmount: new D(original.vatAmount.toString()).negated(),
          whtAmount: new D(original.whtAmount.toString()).negated(),
          netReceived: new D(original.netReceived.toString()).negated(),
          totalAmount: new D(original.totalAmount.toString()).negated(),
          customerNote: `กลับรายการ: ${dto.note}`,
          createdById: userId,
          reversesId: original.id,
          reverseReason: dto.reason,
          reverseNote: dto.note,
          journalEntryId: reverseJe.id,
          receiptNo,
          postedAt: now,
          // Copy items with negated amounts
          items: {
            create: original.items.map((it) => ({
              lineNo: it.lineNo,
              accountCode: it.accountCode,
              accountName: it.accountName,
              description: it.description ? `[กลับรายการ] ${it.description}` : '[กลับรายการ]',
              quantity: new D(it.quantity.toString()),
              unitAmount: new D(it.unitAmount.toString()),
              discountAmount: new D(it.discountAmount.toString()),
              vatPct: new D(it.vatPct.toString()),
              whtPct: new D(it.whtPct.toString()),
              amountBeforeVat: new D(it.amountBeforeVat.toString()).negated(),
              vatAmount: new D(it.vatAmount.toString()).negated(),
              whtAmount: new D(it.whtAmount.toString()).negated(),
            })),
          },
        },
        include: { items: true, adjustments: true },
      });

      // Mark original as REVERSED
      await tx.otherIncome.update({
        where: { id },
        data: {
          status: OtherIncomeStatus.REVERSED,
          reverseReason: dto.reason,
          reverseNote: dto.note,
        },
      });

      return reversalDoc;
    });
  }

  // -------------------------------------------------------------------------
  // copy(): clone DRAFT from existing doc
  // -------------------------------------------------------------------------

  async copy(id: string, userId: string) {
    const src = await this.findOneOrFail(id);
    const companyId = await this.resolveFinanceCompanyId();

    return this.prisma.$transaction(async (tx) => {
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 7);

      const docNumber = await this.docNumber.nextDocNumber(tx, issueDate);

      // Recompute totals from items (do not carry amountReceived)
      const srcItems = src.items.map((it) => ({
        accountCode: it.accountCode,
        description: it.description ?? undefined,
        quantity: Number(it.quantity),
        unitAmount: Number(it.unitAmount),
        discountAmount: Number(it.discountAmount),
        vatPct: Number(it.vatPct),
        whtPct: Number(it.whtPct),
      }));
      const totals = this.computeTotals({
        issueDate: issueDate.toISOString(),
        priceType: src.priceType,
        paymentAccountCode: src.paymentAccountCode,
        amountReceived: 0, // cleared
        items: srcItems,
      } as any);

      return tx.otherIncome.create({
        data: {
          docNumber,
          companyId,
          status: OtherIncomeStatus.DRAFT,
          issueDate,
          dueDate,
          paymentDate: null,
          priceType: src.priceType,
          customerId: src.customerId ?? null,
          counterpartyName: src.counterpartyName ?? null,
          counterpartyTaxId: src.counterpartyTaxId ?? null,
          counterpartyAddress: src.counterpartyAddress ?? null,
          counterpartyPhone: src.counterpartyPhone ?? null,
          paymentAccountCode: src.paymentAccountCode,
          amountReceived: ZERO, // cleared — user must fill in
          incomeGross: totals.incomeGross,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          netReceived: totals.netReceived,
          totalAmount: totals.totalAmount,
          customerNote: src.customerNote ?? null,
          createdById: userId,
          copiedFromId: src.id,
          items: {
            create: totals.items.map((it) => ({
              ...it,
              accountName:
                src.items.find((s) => s.accountCode === it.accountCode)?.accountName ??
                it.accountCode,
            })),
          },
          // no adjustments or attachments copied
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  // -------------------------------------------------------------------------
  // dailySheet(): summary + docs for a given date
  // -------------------------------------------------------------------------

  async dailySheet(date: string) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const docs = await this.prisma.otherIncome.findMany({
      where: {
        status: OtherIncomeStatus.POSTED,
        issueDate: { gte: day, lt: nextDay },
        deletedAt: null,
      },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        adjustments: { orderBy: { lineNo: 'asc' } },
      },
      orderBy: { docNumber: 'asc' },
    });

    // Aggregate summary
    let incomeGross = ZERO;
    let vat = ZERO;
    let wht = ZERO;
    let net = ZERO;

    const byAccountMap = new Map<string, Decimal>();
    const byPaymentMap = new Map<string, Decimal>();

    for (const doc of docs) {
      incomeGross = incomeGross.plus(doc.incomeGross.toString());
      vat = vat.plus(doc.vatAmount.toString());
      wht = wht.plus(doc.whtAmount.toString());
      net = net.plus(doc.netReceived.toString());

      // By income account (from items)
      for (const item of doc.items) {
        const prev = byAccountMap.get(item.accountCode) ?? ZERO;
        byAccountMap.set(item.accountCode, prev.plus(item.amountBeforeVat.toString()));
      }

      // By payment account
      const prevPay = byPaymentMap.get(doc.paymentAccountCode) ?? ZERO;
      byPaymentMap.set(doc.paymentAccountCode, prevPay.plus(doc.amountReceived.toString()));
    }

    // Sort maps by account code
    const byAccount = new Map(
      [...byAccountMap.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    const byPayment = new Map(
      [...byPaymentMap.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );

    return {
      date,
      summary: {
        docCount: docs.length,
        incomeGross,
        vatAmount: vat,
        whtAmount: wht,
        netReceived: net,
      },
      docs,
      byAccount,
      byPayment,
    };
  }

  // -------------------------------------------------------------------------
  // list(): paginated with filters
  // -------------------------------------------------------------------------

  async list(query: ListOtherIncomeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.OtherIncomeWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.startDate || query.endDate
        ? {
            issueDate: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { docNumber: { contains: query.q, mode: 'insensitive' } },
              { counterpartyName: { contains: query.q, mode: 'insensitive' } },
              { receiptNo: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.otherIncome.findMany({
        where,
        include: { items: { orderBy: { lineNo: 'asc' } } },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.otherIncome.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // findOneOrFail()
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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

  /** Read OTHER_INCOME_ATTACHMENT_THRESHOLD from SystemConfig. Falls back to 50_000. */
  private async getAttachmentThreshold(): Promise<number> {
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'OTHER_INCOME_ATTACHMENT_THRESHOLD' },
      });
      if (row) {
        const val = Number(row.value);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch {
      // key doesn't exist yet — use fallback
    }
    return 50_000;
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
