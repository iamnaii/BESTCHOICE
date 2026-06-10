import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OtherIncomeStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocNumberService } from './doc-number.service';
import { ValidationService } from './validation.service';
import { AutoJournalService } from './auto-journal.service';
import { OtherIncomeTemplate } from '../templates/other-income.template';
import { CreateOtherIncomeDto, OtherIncomeItemDto } from '../dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from '../dto/update-other-income.dto';
import { PostOtherIncomeDto } from '../dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from '../dto/reverse-other-income.dto';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { JournalOverrideService, OverrideLine } from './journal-override.service';
import { AuditService } from '../../audit/audit.service';
import { OtherIncomeConfigService } from './other-income-config.service';
import { computeTotals } from './other-income-totals.util';

const D = Prisma.Decimal;

/**
 * Money core for OtherIncome. Owns ALL 7 $transaction (each bundles
 * docNumber.next + writes + template.post JE atomically — NEVER split) plus
 * the canonical findOneOrFail and the shared resolveFinanceCompanyId /
 * auditLifecycle helpers. Plain class — constructed internally by the
 * OtherIncomeService facade.
 */
@Injectable()
export class OtherIncomeLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly validation: ValidationService,
    private readonly autoJournal: AutoJournalService,
    private readonly template: OtherIncomeTemplate,
    private readonly journalOverride: JournalOverrideService,
    private readonly audit: AuditService,
    private readonly config: OtherIncomeConfigService,
  ) {}

  async create(dto: CreateOtherIncomeDto, userId: string) {
    const companyId = await this.resolveFinanceCompanyId();

    const created = await this.prisma.$transaction(async (tx) => {
      const issueDate = new Date(dto.issueDate);
      const docNumber = await this.docNumber.nextDocNumber(tx, issueDate);
      const totals = computeTotals(dto);

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

    await this.auditLifecycle('OI_CREATED', userId, created);
    return created;
  }

  // ─── SP5 Phase 2 — Repair-ticket auto-doc helper ──────────────────────────
  /**
   * Creates a DRAFT OtherIncome within an existing transaction. Called by
   * RepairTicketsService.returnToCustomer() (payer=CUSTOMER path) so the
   * income receipt doc and the ticket state-flip land atomically.
   *
   * Design notes:
   * - Takes a `Prisma.TransactionClient` so the entire returnToCustomer flow
   *   is a single atomic unit — no partial state if doc creation fails.
   * - `amount` is accepted as `Prisma.Decimal` to keep full precision across
   *   the module boundary (no Number() drift).
   * - Skips CoA name resolution round-trip by setting accountName to the code
   *   value directly — acceptable for auto-created drafts; accountant can
   *   review and correct before posting.
   * - No VAT and no WHT for SHOP-side repair income (SHOP not VAT-registered).
   */
  async createDraftForRepair(
    dto: {
      accountCode: string;
      counterpartyName: string;
      customerId: string;
      amount: Prisma.Decimal;
      description: string;
      receivedAt: Date;
      branchId: string;
      createdById: string;
      metadata: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    // Repair income belongs to SHOP entity (SHOP is not VAT-registered — no VAT
    // on repair service fees). Always 'SHOP', never 'FINANCE'. C2 fix.
    const companyId = await tx.companyInfo
      .findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } })
      .then((co) => {
        if (!co) {
          throw new BadRequestException(
            'CompanyInfo with companyCode=SHOP not found — seed accounting data first',
          );
        }
        return co.id;
      });

    const issueDate = dto.receivedAt;
    const docNumber = await this.docNumber.nextDocNumber(tx, issueDate);

    // Single item: no VAT, no WHT (SHOP not VAT-registered; repair income is service fee)
    const itemAmount = dto.amount;
    const itemsWithName = [
      {
        lineNo: 1,
        accountCode: dto.accountCode,
        accountName: dto.accountCode, // name resolved by accountant before posting
        description: dto.description,
        quantity: new D(1),
        unitAmount: itemAmount,
        discountAmount: new D(0),
        vatPct: new D(0),
        whtPct: new D(0),
        amountBeforeVat: itemAmount,
        vatAmount: new D(0),
        whtAmount: new D(0),
      },
    ];

    const doc = await tx.otherIncome.create({
      data: {
        docNumber,
        companyId,
        status: OtherIncomeStatus.DRAFT,
        issueDate,
        paymentDate: dto.receivedAt,
        priceType: 'EXCLUSIVE',
        customerId: dto.customerId,
        counterpartyName: dto.counterpartyName,
        paymentAccountCode: '11-1201', // default cash/bank; accountant adjusts before post
        amountReceived: itemAmount,
        incomeGross: itemAmount,
        vatAmount: new D(0),
        whtAmount: new D(0),
        netReceived: itemAmount,
        totalAmount: itemAmount,
        customerNote: dto.description,
        createdById: dto.createdById,
        items: { create: itemsWithName },
      },
      select: { id: true },
    });

    return { id: doc.id };
  }

  async update(id: string, dto: UpdateOtherIncomeDto, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${existing.docNumber} สถานะ ${existing.status} — ไม่สามารถแก้ไขได้ใน DRAFT เท่านั้น`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
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
        amountReceived: dto.amountReceived ?? (existing.amountReceived.toString() as any),
        items: (dto.items ??
          existing.items.map((i) => ({
            accountCode: i.accountCode,
            description: i.description ?? undefined,
            quantity: i.quantity.toString() as any,
            unitAmount: i.unitAmount.toString() as any,
            discountAmount: i.discountAmount.toString() as any,
            vatPct: i.vatPct.toString() as any,
            whtPct: i.whtPct.toString() as any,
          }))) as OtherIncomeItemDto[],
        adjustments:
          dto.adjustments ??
          existing.adjustments?.map((a) => ({
            accountCode: a.accountCode,
            amount: a.amount.toString() as any,
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
      const totals = computeTotals(merged);

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

    await this.auditLifecycle('OI_UPDATED', userId, updated);
    return updated;
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(`เอกสาร POSTED/REVERSED ลบไม่ได้ — ใช้ Reverse Entry`);
    }
    const deleted = await this.prisma.otherIncome.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { items: true, adjustments: true },
    });

    await this.auditLifecycle('OI_DELETED', userId, deleted);
    return deleted;
  }

  // -------------------------------------------------------------------------
  // requestApproval(): PR-2 — DRAFT → READY
  // -------------------------------------------------------------------------

  /**
   * PR-2: DRAFT → READY. Only callable when Maker-Checker flag is enabled.
   * Maker initiates the approval cycle. State stays in DRAFT until approver acts.
   */
  async requestApproval(id: string, userId: string) {
    if (!(await this.config.isMakerCheckerEnabled())) {
      throw new BadRequestException('Maker-Checker ปิดอยู่ — ใช้ /post โดยตรง');
    }
    const doc = await this.findOneOrFail(id);
    if (doc.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ไม่สามารถส่งขออนุมัติได้`,
      );
    }
    // Reset any prior reject metadata (re-submission after rejection)
    const requested = await this.prisma.otherIncome.update({
      where: { id },
      data: {
        status: OtherIncomeStatus.READY,
        rejectedAt: null,
        rejectedById: null,
        rejectNote: null,
      },
      include: { items: true, adjustments: true },
    });

    await this.auditLifecycle('OI_APPROVAL_REQUESTED', userId, requested);
    return requested;
  }

  // -------------------------------------------------------------------------
  // approve(): PR-2 — READY → POSTED atomic
  // -------------------------------------------------------------------------

  /**
   * PR-2: READY → POSTED atomically (APPROVED is transient inside tx).
   * V9: approver must differ from maker (createdById).
   */
  async approve(
    id: string,
    dto: { note?: string },
    userId: string,
  ) {
    if (!(await this.config.isMakerCheckerEnabled())) {
      throw new BadRequestException('Maker-Checker ปิดอยู่');
    }
    const doc = await this.findOneOrFail(id);
    if (doc.status !== OtherIncomeStatus.READY) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ไม่สามารถอนุมัติ`,
      );
    }
    // V9: maker ≠ approver
    if (doc.createdById === userId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: [
          {
            rule: 'V9',
            msg: 'ผู้สร้างเอกสารไม่สามารถอนุมัติเอกสารตัวเองได้',
          },
        ],
      });
    }

    // Re-run validation (period lock, balance, etc.) — happens outside tx, fine
    // because the CAS-claim below is the real concurrency gate.
    const companyId = await this.resolveFinanceCompanyId();
    await validatePeriodOpen(this.prisma, doc.issueDate, companyId);

    const threshold = await this.config.getAttachmentThreshold();
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
      isPeriodOpen: () => true,
      attachmentThreshold: threshold,
      hasAttachment: doc.attachments.length > 0,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'ไม่ผ่านการตรวจสอบก่อนอนุมัติ', errors });
    }

    const jeLines = this.autoJournal.generate({
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

    const approved = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // CAS-claim: atomically flip READY → POSTED, but only if still READY.
      // This guards against two OWNERs approving simultaneously — only one
      // updateMany will affect a row. The loser sees count===0 and bails out.
      const claimed = await tx.otherIncome.updateMany({
        where: { id, status: OtherIncomeStatus.READY },
        data: {
          status: OtherIncomeStatus.POSTED,
          approverId: userId,
          approvedAt: now,
          approveNote: dto.note ?? null,
          postedAt: now,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `เอกสาร ${doc.docNumber} ถูกอนุมัติหรือปฏิเสธโดยผู้อื่นแล้ว — กรุณารีโหลด`,
        );
      }

      const receiptNo = await this.docNumber.nextReceiptNumber(tx, doc.issueDate);

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
        data: { receiptNo, journalEntryId: je.id },
        include: { items: true, adjustments: true },
      });
    });

    await this.auditLifecycle('OI_APPROVED', userId, approved, {
      receiptNo: approved.receiptNo,
      journalEntryId: approved.journalEntryId,
    });
    return approved;
  }

  // -------------------------------------------------------------------------
  // reject(): PR-2 — READY → DRAFT
  // -------------------------------------------------------------------------

  /** PR-2: READY → DRAFT. Persists rejection note + rejecter. */
  async reject(
    id: string,
    dto: { note: string },
    userId: string,
  ) {
    if (!(await this.config.isMakerCheckerEnabled())) {
      throw new BadRequestException('Maker-Checker ปิดอยู่');
    }
    if (!dto.note || dto.note.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุหมายเหตุการปฏิเสธ');
    }
    const doc = await this.findOneOrFail(id);
    if (doc.status !== OtherIncomeStatus.READY) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ไม่สามารถปฏิเสธได้`,
      );
    }
    // CAS: atomically flip READY → DRAFT, only if still READY.
    // Mirrors the same guard used in approve() against concurrent approver actions.
    const claimed = await this.prisma.otherIncome.updateMany({
      where: { id, status: OtherIncomeStatus.READY },
      data: {
        status: OtherIncomeStatus.DRAFT,
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectNote: dto.note,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} ถูกอนุมัติหรือปฏิเสธโดยผู้อื่นแล้ว — กรุณารีโหลด`,
      );
    }
    const rejected = await this.findOneOrFail(id);
    await this.auditLifecycle('OI_REJECTED', userId, rejected, {
      fromStatus: 'READY',
      toStatus: 'DRAFT',
      rejectNote: dto.note,
    });
    return rejected;
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

    // V8: period lock check (non-transactional pre-check) — B1: pass companyId so
    // AccountingPeriod tier-1 check fires (without it, only legacy SystemConfig is consulted)
    const companyId = await this.resolveFinanceCompanyId();
    await validatePeriodOpen(this.prisma, doc.issueDate, companyId);

    // Compute attachment threshold
    const threshold = await this.config.getAttachmentThreshold();
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

    // Always compute the auto baseline — needed for diff_summary when override is used
    const autoJeLines: OverrideLine[] = this.autoJournal.generate({
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
    }).map((l) => ({
      accountCode: l.accountCode,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    }));

    let jeLines: OverrideLine[];
    let overrideLinesForAudit: OverrideLine[] | null = null;

    if (dto.override && dto.overrideLines && dto.overrideLines.length > 0) {
      const overrideLines: OverrideLine[] = dto.overrideLines.map((l) => ({
        accountCode: l.accountCode,
        debit: new D(l.debit),
        credit: new D(l.credit),
        description: l.description,
      }));

      // Throws BadRequestException with V1/V2/V5 errors
      this.journalOverride.validate(overrideLines);

      jeLines = overrideLines;
      overrideLinesForAudit = overrideLines;
    } else {
      jeLines = autoJeLines;
    }

    const posted = await this.prisma.$transaction(async (tx) => {
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
          isOverridden: overrideLinesForAudit !== null,
          postedAt: now,
        },
        include: { items: true, adjustments: true },
      });
    });

    await this.auditLifecycle('OI_POSTED', userId, posted, {
      receiptNo: posted.receiptNo,
      journalEntryId: posted.journalEntryId,
      isOverridden: posted.isOverridden,
    });

    // Write JV_OVERRIDDEN audit outside transaction (non-blocking on TX connection)
    if (overrideLinesForAudit) {
      const diffSummary = this.journalOverride.computeDiffSummary(autoJeLines, overrideLinesForAudit);
      try {
        await this.audit.log({
          userId,
          action: 'JV_OVERRIDDEN',
          entity: 'other_income',
          entityId: doc.id,
          oldValue: {
            jvLines: autoJeLines.map((l) => ({
              accountCode: l.accountCode,
              debit: l.debit.toString(),
              credit: l.credit.toString(),
              description: l.description ?? null,
            })),
          },
          newValue: {
            jvLines: overrideLinesForAudit.map((l) => ({
              accountCode: l.accountCode,
              debit: l.debit.toString(),
              credit: l.credit.toString(),
              description: l.description ?? null,
            })),
            diffSummary,
          },
        });
      } catch (err) {
        // OtherIncome is already POSTED — never throw and rollback the response.
        // Capture to Sentry so accounting can manually reconcile audit gaps.
        Sentry.captureException(err, {
          tags: { module: 'other-income', action: 'JV_OVERRIDDEN' },
          extra: { otherIncomeId: doc.id, docNumber: doc.docNumber },
        });
      }
    }

    return posted;
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

    // Period lock on today — the reversal JE is posted today, not on original's issueDate.
    // B1: pass companyId so AccountingPeriod tier-1 check fires.
    const companyId = await this.resolveFinanceCompanyId();
    await validatePeriodOpen(this.prisma, new Date(), companyId);

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

    const reversal = await this.prisma.$transaction(async (tx) => {
      const issueDate = new Date();
      // W15 — Append "-R" suffix so reversal docs are visually distinct from
      // originals in list views without needing to open the detail page.
      // Example: OI-20260514-0003 → OI-20260514-0003-R.
      const baseReverseDocNumber = await this.docNumber.nextDocNumber(tx, issueDate);
      const reverseDocNumber = `${baseReverseDocNumber}-R`;
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
          reverseReasonLabel: dto.reasonLabel ?? null,
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
          reverseReasonLabel: dto.reasonLabel ?? null,
        },
      });

      return reversalDoc;
    });

    await this.auditLifecycle('OI_REVERSED', userId, reversal, {
      originalDocNumber: original.docNumber,
      reverseReason: dto.reason,
      reverseReasonLabel: dto.reasonLabel ?? null,
      reverseNote: dto.note,
    });
    return reversal;
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

      // W8 — Carry over `amountReceived` from source so the clone POSTs without
      // a V10 violation (diff = 0). Resetting it to 0 while preserving the items
      // produced unpostable DRAFTs because computeTotals.netReceived stayed > 0
      // but amountReceived = 0 → diff ≠ 0 → V10 error.
      const srcItems = src.items.map((it) => ({
        accountCode: it.accountCode,
        description: it.description ?? undefined,
        quantity: it.quantity.toString() as any,
        unitAmount: it.unitAmount.toString() as any,
        discountAmount: it.discountAmount.toString() as any,
        vatPct: it.vatPct.toString() as any,
        whtPct: it.whtPct.toString() as any,
      }));
      const srcAmountReceived = new D(src.amountReceived.toString()).toNumber();
      const totals = computeTotals({
        issueDate: issueDate.toISOString(),
        priceType: src.priceType,
        paymentAccountCode: src.paymentAccountCode,
        amountReceived: srcAmountReceived,
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
          // W8 — Carry over source amountReceived so the cloned DRAFT can POST
          // without a V10 (diff ≠ 0) violation; user can still adjust.
          amountReceived: new D(srcAmountReceived.toString()),
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
        // `reversedBy` is the auto-derived inverse of the unique self-FK `reversesId`.
        // The ViewPage uses this to render "ดูเอกสาร Reversing Entry" on the original
        // doc once it has been reversed. Without this include the link never appears.
        reversedBy: { select: { id: true, docNumber: true } },
        // W6 — `reverses` is the forward self-FK from a `-R` doc back to its
        // original POSTED parent. ViewPage uses it to render
        // "เอกสารนี้กลับรายการของ <docNumber>" when viewing a -R reversal doc.
        reverses: { select: { id: true, docNumber: true } },
        // Maker + approver name surfaced into the InternalControlBar so we don't
        // mis-attribute the bar to the currently-logged-in viewer (PDF Section 5).
        createdBy: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } },
      },
    });
    if (!doc) throw new NotFoundException(`OtherIncome ${id} not found`);
    return doc;
  }

  // -------------------------------------------------------------------------
  // Shared private helpers (used by all writers)
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

  /**
   * Lifecycle audit. Non-blocking — never throws to caller; Sentry on failure.
   * Used by create/update/post/reverse/softDelete/approve/reject/requestApproval.
   */
  private async auditLifecycle(
    action:
      | 'OI_CREATED'
      | 'OI_UPDATED'
      | 'OI_DELETED'
      | 'OI_POSTED'
      | 'OI_REVERSED'
      | 'OI_APPROVED'
      | 'OI_REJECTED'
      | 'OI_APPROVAL_REQUESTED',
    userId: string,
    doc: { id: string; docNumber: string; status?: string | null },
    extra?: Record<string, unknown>,
  ) {
    try {
      await this.audit.log({
        userId,
        action,
        entity: 'other_income',
        entityId: doc.id,
        newValue: { docNumber: doc.docNumber, status: doc.status ?? null, ...extra },
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { module: 'other-income', action },
        extra: { otherIncomeId: doc.id, docNumber: doc.docNumber },
      });
    }
  }
}
