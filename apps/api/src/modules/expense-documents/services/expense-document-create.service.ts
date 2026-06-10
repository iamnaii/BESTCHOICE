import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { maskPayrollTaxIds } from '../payroll-pii-mask.util';
import {
  assertCategoriesAreExpense,
  validateAdjustments,
} from '../expense-validators.util';
import { DocNumberService } from './doc-number.service';
import { StatusTransitionService } from './status-transition.service';
import { LineAggregatorService } from './line-aggregator.service';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { PettyCashService } from './petty-cash.service';
import { PayrollCustomService } from './payroll-custom.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { readBoolFlag, readIntFlag } from '../../../utils/config.util';
import { CreateExpenseDocumentDto } from '../dto/create.dto';
import { UpdateExpenseDocumentDto } from '../dto/update.dto';
import { CreateCreditNoteDto } from '../dto/create-credit-note.dto';
import { CreatePayrollDto } from '../dto/create-payroll.dto';
import { CreateSettlementDto } from '../dto/create-settlement.dto';
import { CreatePettyCashDto } from '../dto/create-petty-cash.dto';

/**
 * Phase 3 (final) of the transactional-core decompose: the CREATE-FAMILY +
 * `update` methods of ExpenseDocumentsService, extracted VERBATIM. The facade
 * delegates to this service so the public contract (controller + callers) is
 * unchanged.
 *
 * Owns: create, createDraftForRepair, createCreditNote, createPayroll,
 * createSettlement, createPettyCash, update — plus a verbatim copy of the
 * private `readBoolFlag` config-flag wrapper (createSettlement + createPettyCash
 * use `this.readBoolFlag`).
 *
 * Behavior-preserving — method bodies are byte-identical to the pre-extraction
 * facade; only import paths were adjusted for the deeper directory.
 */
@Injectable()
export class ExpenseDocumentCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly aggregator: LineAggregatorService,
    private readonly transition: StatusTransitionService,
    private readonly ssoConfig: SsoConfigService,
    private readonly payrollCustom: PayrollCustomService,
    private readonly pettyCash: PettyCashService,
  ) {}

  // ─── D1.* — Service-side SystemConfig flag readers ─────────────────────
  // Delegates to shared `readBoolFlag` in utils/config.util
  // so every service uses identical parsing + defensive try/catch semantics.
  // Kept as private wrappers for ergonomic (this.readBoolFlag) call sites.
  // Spec-defined defaults flow through `fallback` and preserve first-boot
  // behaviour when the SystemConfig row is missing.
  private async readBoolFlag(
    tx: Prisma.TransactionClient | PrismaService,
    key: string,
    fallback: boolean,
  ): Promise<boolean> {
    return readBoolFlag(tx, key, fallback);
  }


  // ─── Create ──────────────────────────────────────────────────────────
  async create(dto: CreateExpenseDocumentDto, userId: string) {
    const documentDate = new Date(dto.documentDate);
    const priceType = dto.priceType ?? 'EXCLUSIVE';

    // Compute per-line totals + aggregate
    const linesPrepared = dto.lines.map((l, idx) => {
      const out = this.aggregator.computeLine(l, priceType);
      return { ...l, lineNo: idx + 1, ...out };
    });
    const totals = this.aggregator.aggregateLines(linesPrepared);

    return this.prisma.$transaction(async (tx) => {
      // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
      await assertCategoriesAreExpense(
        tx,
        linesPrepared.map((l) => l.category),
      );

      // Fix Report P0-4 — multi-line adjustment validation (V12/V13/V14).
      // Shared helper used here (EXPENSE) and by createSettlement (B2 / SE).
      const totalAmount = new Prisma.Decimal(totals.totalAmount.toString());
      const wht = new Prisma.Decimal(totals.withholdingTax.toString());
      const netExpected = totalAmount.minus(wht);
      const amountPaid =
        dto.amountPaid !== undefined ? new Prisma.Decimal(dto.amountPaid) : netExpected;
      const adjustments = dto.adjustments ?? [];
      await validateAdjustments(tx, { adjustments, netExpected, amountPaid });

      const number = await this.docNumber.next(tx, 'EXPENSE', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          vendorTaxId: dto.vendorTaxId ?? null,
          // Party-master link (Phase 3 P3) — durable FK when the picker resolved a supplier.
          vendorSupplierId: dto.vendorSupplierId ?? null,
          taxInvoiceNo: dto.taxInvoiceNo ?? null,
          description: dto.description ?? null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          withholdingTax: totals.withholdingTax,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: totals.totalAmount,
          netPayment: dto.depositAccountCode ? amountPaid : null,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          approvedById: dto.approvedById ?? null,
          // Phase A.5 — tax-disallowed flag (ม.65 ตรี). Lines inherit from doc-level
          // unless they set their own override.
          taxDisallowed: dto.taxDisallowed ?? false,
          createdById: userId,
          expenseDetail: {
            create: {
              priceType,
              lines: {
                create: linesPrepared.map((l) => ({
                  lineNo: l.lineNo,
                  category: l.category,
                  description: l.description ?? null,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitPrice: new Prisma.Decimal(l.unitPrice),
                  discount: new Prisma.Decimal(l.discount ?? 0),
                  vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                  whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                  whtFormType: l.whtFormType ?? null,
                  amountBeforeVat: l.amountBeforeVat,
                  vatAmount: l.vatAmount,
                  whtAmount: l.whtAmount,
                  taxDisallowed: l.taxDisallowed ?? false,
                })),
              },
            },
          },
          adjustments:
            adjustments.length > 0
              ? {
                  create: adjustments.map((a, idx) => ({
                    lineNo: idx + 1,
                    accountCode: a.accountCode,
                    side: a.side,
                    amount: new Prisma.Decimal(a.amount),
                    note: a.note ?? null,
                  })),
                }
              : undefined,
        },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          adjustments: { orderBy: { lineNo: 'asc' } },
        },
      });
    });
  }

  // ─── SP5 Phase 2 — Repair-ticket auto-doc helper ──────────────────────────
  /**
   * Creates a DRAFT ExpenseDocument of type REPAIR_SERVICE within an existing
   * transaction. Called by RepairTicketsService.returnToCustomer() (payer=SHOP
   * path) so the repair cost doc and the ticket state-flip land atomically.
   *
   * Design notes:
   * - Takes a `Prisma.TransactionClient` so the entire returnToCustomer flow
   *   is a single atomic unit — no partial state if doc creation fails.
   * - `amount` is accepted as `Prisma.Decimal` to keep full precision across
   *   the module boundary (no Number() drift).
   * - Skips the CoA-type guard (5x-xxxx "ค่าใช้จ่าย" check) because the
   *   account code comes from SystemConfig, not from user input. Validated at
   *   configuration time by the OWNER.
   * - Skips the multi-line adjustment validation (V12/V13/V14) — single-line
   *   doc with no adjustments.
   */
  async createDraftForRepair(
    dto: {
      vendorName: string;
      vendorSupplierId?: string;
      amount: Prisma.Decimal;
      accountCode: string;
      description: string;
      branchId: string;
      createdById: string;
      metadata: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const documentDate = new Date();

    const line = this.aggregator.computeLine(
      {
        quantity: 1,
        unitPrice: dto.amount,
        vatPercent: 0,
        whtPercent: 0,
      },
      'EXCLUSIVE',
    );
    const totals = this.aggregator.aggregateLines([line]);

    const number = await this.docNumber.next(tx, 'REPAIR_SERVICE', documentDate);

    const doc = await tx.expenseDocument.create({
      data: {
        number,
        documentType: 'REPAIR_SERVICE',
        branchId: dto.branchId,
        documentDate,
        vendorName: dto.vendorName,
        ...(dto.vendorSupplierId ? { vendorSupplierId: dto.vendorSupplierId } : {}),
        description: dto.description,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        withholdingTax: totals.withholdingTax,
        totalAmount: totals.totalAmount,
        status: 'DRAFT',
        taxDisallowed: false,
        createdById: dto.createdById,
        // W6: human-readable note (metadata traceability via FK repairTicketId on
        // the RepairTicket → expenseDocumentId back-reference; no need to embed JSON).
        note: `Auto-created from repair ticket ${(dto.metadata as { repairTicketId?: string }).repairTicketId ?? ''}`,
        expenseDetail: {
          create: {
            priceType: 'EXCLUSIVE',
            lines: {
              create: [
                {
                  lineNo: 1,
                  category: dto.accountCode,
                  description: dto.description,
                  quantity: new Prisma.Decimal(1),
                  unitPrice: dto.amount,
                  discount: new Prisma.Decimal(0),
                  vatPercent: new Prisma.Decimal(0),
                  whtPercent: new Prisma.Decimal(0),
                  amountBeforeVat: line.amountBeforeVat,
                  vatAmount: line.vatAmount,
                  whtAmount: line.whtAmount,
                  taxDisallowed: false,
                },
              ],
            },
          },
        },
      },
      select: { id: true },
    });

    return { id: doc.id };
  }

  // ─── Credit Note create (validates + computes totals from lines) ──────────
  // C4 · 2-Mode:
  //   - LINKED (default): full path with original lookup, advisory lock, cap
  //     check, branch match, no-WHT guard.
  //   - STANDALONE: free-form refund with no source FK. Requires vendorName.
  //     Skips lookup + cap + branch match (no original to match against).
  //     JE template branches on creditNote.mode to omit the original Dr leg.
  async createCreditNote(dto: CreateCreditNoteDto, userId: string) {
    const mode = dto.mode ?? 'LINKED';
    if (mode === 'LINKED' && !dto.originalDocumentId) {
      throw new BadRequestException('โหมด LINKED ต้องระบุเอกสารต้นฉบับ');
    }
    if (mode === 'STANDALONE' && !dto.vendorName?.trim()) {
      throw new BadRequestException('โหมด STANDALONE ต้องระบุชื่อผู้ขาย');
    }

    // Compute per-line totals + aggregate server-side.
    // dto.subtotal/vatAmount are IGNORED — server is the source of truth.
    const priceType = 'EXCLUSIVE';
    const linesPrepared = dto.lines.map((l, idx) => {
      const out = this.aggregator.computeLine(l, priceType);
      return { ...l, lineNo: idx + 1, ...out };
    });
    const totals = this.aggregator.aggregateLines(linesPrepared);

    return this.prisma.$transaction(async (tx) => {
      // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
      await assertCategoriesAreExpense(
        tx,
        linesPrepared.map((l) => l.category),
      );

      // LINKED-mode validation: source lookup + cap + WHT guard under advisory lock.
      // STANDALONE-mode skips this — there is no source document.
      let originalVendorName: string | null = null;
      let originalVendorTaxId: string | null = null;
      let originalVendorSupplierId: string | null = null;
      if (mode === 'LINKED') {
        // I2 fix — acquire the advisory lock BEFORE loading the original so a
        // concurrent void/edit can't slip between the read and the cap check.
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          dto.originalDocumentId!,
        );

        const original = await tx.expenseDocument.findUniqueOrThrow({
          where: { id: dto.originalDocumentId! },
          include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
        });
        if (original.deletedAt) {
          throw new NotFoundException('เอกสารต้นฉบับถูกลบแล้ว');
        }
        if (original.branchId !== dto.branchId) {
          throw new BadRequestException('ใบลดหนี้ต้องอยู่สาขาเดียวกับเอกสารต้นฉบับ');
        }
        if (original.documentType !== 'EXPENSE') {
          throw new BadRequestException('ใบลดหนี้ใช้ลดเอกสารรายจ่ายเท่านั้น');
        }
        if (!['ACCRUAL', 'POSTED'].includes(original.status)) {
          throw new BadRequestException(`ไม่สามารถออกใบลดหนี้บนเอกสารสถานะ ${original.status}`);
        }

        const origWht = new Prisma.Decimal(original.withholdingTax?.toString() ?? '0');
        if (origWht.gt(0)) {
          throw new BadRequestException(
            'ไม่รองรับใบลดหนี้บนเอกสารที่มีการหัก ณ ที่จ่าย — กรุณาใช้การยกเลิก (void) แล้วสร้างเอกสารใหม่',
          );
        }

        // Cumulative cap check — use server-computed totals.totalAmount
        const priorAgg = await tx.expenseDocument.aggregate({
          where: {
            documentType: 'CREDIT_NOTE',
            status: { not: 'VOIDED' },
            deletedAt: null,
            creditNote: { originalDocumentId: dto.originalDocumentId },
          },
          _sum: { totalAmount: true },
        });
        const priorTotal = new Prisma.Decimal(priorAgg._sum.totalAmount ?? 0);

        const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(priorTotal);
        if (totals.totalAmount.gt(cap)) {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดที่ลดได้ (เหลือ ${cap.toFixed(2)} ฿)`,
          );
        }

        // Inherit vendor info from source for traceability on the CN doc.
        originalVendorName = original.vendorName;
        originalVendorTaxId = original.vendorTaxId;
        // Party-master link (Phase 3 P3) — carry the source doc's supplier FK forward.
        originalVendorSupplierId = original.vendorSupplierId;
      }

      const documentDate = new Date(dto.documentDate);
      const number = await this.docNumber.next(tx, 'CREDIT_NOTE', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'CREDIT_NOTE',
          branchId: dto.branchId,
          documentDate,
          // LINKED inherits vendor from source; STANDALONE takes from DTO.
          vendorName:
            mode === 'STANDALONE' ? (dto.vendorName?.trim() ?? null) : originalVendorName,
          vendorTaxId:
            mode === 'STANDALONE' ? (dto.vendorTaxId?.trim() ?? null) : originalVendorTaxId,
          // Party-master link (Phase 3 P3) — STANDALONE from DTO, LINKED from source.
          vendorSupplierId:
            mode === 'STANDALONE' ? (dto.vendorSupplierId ?? null) : originalVendorSupplierId,
          description: dto.description ?? null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          withholdingTax: new Prisma.Decimal(0),
          totalAmount: totals.totalAmount,
          netPayment: dto.depositAccountCode ? totals.netPayment : null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: userId,
          creditNote: {
            create: {
              mode,
              originalDocumentId: mode === 'LINKED' ? dto.originalDocumentId! : null,
              reason: dto.reason,
            },
          },
          expenseDetail: {
            create: {
              priceType,
              lines: {
                create: linesPrepared.map((l) => ({
                  lineNo: l.lineNo,
                  category: l.category,
                  description: l.description ?? null,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitPrice: new Prisma.Decimal(l.unitPrice),
                  discount: new Prisma.Decimal(l.discount ?? 0),
                  vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                  whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                  whtFormType: l.whtFormType ?? null,
                  amountBeforeVat: l.amountBeforeVat,
                  vatAmount: l.vatAmount,
                  whtAmount: l.whtAmount,
                })),
              },
            },
          },
        },
        include: {
          creditNote: true,
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        },
      });
    });
  }

  // ─── Payroll create — multi-line, computes netPaid per line ──────────
  async createPayroll(
    dto: CreatePayrollDto,
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    // Branch access enforcement: users without cross-branch role
    // can only create payroll documents for their own branch.
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

    // SSO cap is law-mandated (กฎกระทรวง) and changes ~every 3 years. The
    // applicable cap depends on the payroll's documentDate, not the static
    // value we'd otherwise hardcode in the DTO @Max decorator. Validate each
    // line against the period-effective cap from sso_config.
    const docDate = new Date(dto.documentDate);
    for (const l of dto.lines) {
      await this.ssoConfig.validateContribution(docDate, l.ssoEmployee);
    }

    // C2 — V17 whitelist lookup once (per request), then V16/V17/V18 per line.
    const whitelist = await this.payrollCustom.loadWhitelist();

    // PR-C — resolve linked employees once. Lines with a userId get their
    // name/taxId snapshot derived from the registry (spec §4.2 — never trust
    // the client-sent snapshot). A userId that isn't an ACTIVE payroll
    // employee (no profile / soft-deleted / resigned) is rejected.
    const linkedUserIds = [
      ...new Set(dto.lines.filter((l) => l.userId).map((l) => l.userId as string)),
    ];
    const employeeByUserId = new Map<string, { name: string; taxId: string | null }>();
    if (linkedUserIds.length > 0) {
      const profiles = await this.prisma.employeeProfile.findMany({
        where: {
          userId: { in: linkedUserIds },
          deletedAt: null,
          OR: [{ resignedDate: null }, { resignedDate: { gt: new Date() } }],
          user: { is: { isActive: true, deletedAt: null } },
        },
        include: { user: { select: { id: true, name: true, nationalId: true } } },
      });
      for (const p of profiles) {
        employeeByUserId.set(p.userId, {
          name: p.user.name,
          taxId: p.taxIdOverride ?? p.user.nationalId,
        });
      }
      const missing = linkedUserIds.filter((id) => !employeeByUserId.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          'พนักงานที่เลือกบางรายไม่อยู่ในทะเบียนพนักงาน หรือลาออก/ถูกลบแล้ว — ' +
            'กรุณาเลือกใหม่หรือเพิ่มที่หน้าทะเบียนพนักงาน',
        );
      }
    }

    // Compute netPaid per line + validate
    const preparedRows = await Promise.all(
      dto.lines.map(async (l) => {
        // PR-C — derive snapshot from the linked employee when present.
        const linked = l.userId ? employeeByUserId.get(l.userId) ?? null : null;
        const employeeName = linked ? linked.name : (l.employeeName ?? '').trim();
        const employeeTaxId = linked ? linked.taxId : (l.employeeTaxId ?? null);
        if (!l.userId && employeeName.length < 2) {
          throw new BadRequestException(
            'แต่ละแถวต้องเลือกพนักงานจากทะเบียน หรือระบุชื่อพนักงาน (อย่างน้อย 2 ตัวอักษร)',
          );
        }

        const base = new Prisma.Decimal(l.baseSalary);
        const sso = new Prisma.Decimal(l.ssoEmployee ?? 0);
        const wht = new Prisma.Decimal(l.whtAmount ?? 0);
        // C2 — V16/V17/V18 validators + taxableBase result (not used here yet;
        // exposed for future automatic-WHT-compute consumers).
        await this.payrollCustom.validateLine(
          {
            employeeName,
            baseSalary: base,
            customIncome: l.customIncome,
            customDeduction: l.customDeduction,
          },
          whitelist,
        );

        const sumIncome = (l.customIncome ?? []).reduce<Prisma.Decimal>(
          (s, r) => s.plus(new Prisma.Decimal(r.amount)),
          new Prisma.Decimal(0),
        );
        const sumDeduction = (l.customDeduction ?? []).reduce<Prisma.Decimal>(
          (s, r) => s.plus(new Prisma.Decimal(r.amount)),
          new Prisma.Decimal(0),
        );

        // Net cash = base + income − sso − wht − deduction
        const netPaid = base.plus(sumIncome).minus(sso).minus(wht).minus(sumDeduction);
        if (netPaid.lt(0)) {
          throw new BadRequestException(
            `พนักงาน "${employeeName}" — เงินสุทธิติดลบ ` +
              `(ฐาน ${base} + รายได้พิเศษ ${sumIncome} - SSO ${sso} - WHT ${wht} - หัก ${sumDeduction})`,
          );
        }
        return {
          userId: l.userId ?? null,
          employeeName,
          employeeTaxId,
          baseSalary: base,
          ssoEmployee: sso,
          whtAmount: wht,
          netPaid,
          customIncome: (l.customIncome ?? []).map((r) => ({
            accountCode: r.accountCode,
            name: r.name,
            amount: new Prisma.Decimal(r.amount),
            isTaxable: r.isTaxable !== false,
          })),
          customDeduction: (l.customDeduction ?? []).map((r) => ({
            accountCode: r.accountCode,
            name: r.name,
            amount: new Prisma.Decimal(r.amount),
          })),
        };
      }),
    );
    const linesPrepared = preparedRows;

    if (linesPrepared.length === 0) {
      throw new BadRequestException('ต้องมีพนักงานอย่างน้อย 1 คน');
    }

    const sumBase = linesPrepared.reduce(
      (s, l) => s.plus(l.baseSalary),
      new Prisma.Decimal(0),
    );
    const sumWht = linesPrepared.reduce(
      (s, l) => s.plus(l.whtAmount),
      new Prisma.Decimal(0),
    );
    const sumNet = linesPrepared.reduce(
      (s, l) => s.plus(l.netPaid),
      new Prisma.Decimal(0),
    );

    const documentDate = new Date(dto.documentDate);
    const doc = await this.prisma.$transaction(async (tx) => {
      const number = await this.docNumber.next(tx, 'PAYROLL', documentDate);
      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'PAYROLL',
          branchId: dto.branchId,
          documentDate,
          description: dto.description ?? null,
          subtotal: sumBase,
          vatAmount: new Prisma.Decimal(0),
          withholdingTax: sumWht,
          totalAmount: sumBase,
          netPayment: sumNet,
          depositAccountCode: dto.depositAccountCode,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: user.id,
          payroll: {
            create: {
              payrollPeriod: dto.payrollPeriod,
              lines: {
                create: linesPrepared.map((l) => ({
                  userId: l.userId,
                  employeeName: l.employeeName,
                  employeeTaxId: l.employeeTaxId,
                  baseSalary: l.baseSalary,
                  ssoEmployee: l.ssoEmployee,
                  whtAmount: l.whtAmount,
                  netPaid: l.netPaid,
                  // C2 — nested custom income/deduction (Prisma create relation)
                  customIncome:
                    l.customIncome.length > 0
                      ? { create: l.customIncome }
                      : undefined,
                  customDeduction:
                    l.customDeduction.length > 0
                      ? { create: l.customDeduction }
                      : undefined,
                })),
              },
            },
          },
        },
        include: {
          payroll: {
            include: {
              lines: {
                include: {
                  customIncome: true,
                  customDeduction: true,
                },
              },
            },
          },
        },
      });
    });

    // PR-C PII — the snapshot employeeTaxId === the employee's nationalId (or
    // override). Mask it in the response for roles PR-A blocks from national
    // IDs, so a draft payroll can't enumerate them.
    maskPayrollTaxIds(doc, user.role);
    return doc;
  }

  // ─── Vendor Settlement create — multi-line clears ACCRUAL EXs ────────
  async createSettlement(
    dto: CreateSettlementDto,
    user: { id: string; branchId?: string | null; role?: string },
  ) {
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

    // D1.3.6.1 — `settlement_max_bills_per_doc` (default 100, clamp 1–500).
    // Enforce the cap before any DB lookups so a 1000-line payload can't burn
    // advisory locks / aggregate queries unnecessarily. Reads from the plain
    // PrismaService here (outside the $transaction below) because
    // SystemConfig values rarely change mid-request and this is a soft gate
    // rather than a row-level invariant.
    const maxBills = await readIntFlag(
      this.prisma,
      'settlement_max_bills_per_doc',
      100,
      1,
      500,
    );
    if (dto.lines.length > maxBills) {
      throw new BadRequestException(
        `จำนวนใบที่จะเคลียร์ในเอกสารเดียวเกินจำกัด (สูงสุด ${maxBills} ใบ ต่อเอกสาร)`,
      );
    }

    // D1.3.6.3 — `settlement_partial_payment_enabled` (default true). Read
    // outside the $transaction since this is a doc-creation policy gate and
    // SystemConfig values rarely change mid-request. When OFF, every line's
    // `amountSettled` must equal the remaining cap (full settlement only) —
    // we apply that check INSIDE the transaction after we've read the
    // current cap, so partial-flag toggling between request fetch + commit
    // is fine.
    const partialPaymentEnabled = await this.readBoolFlag(
      this.prisma,
      'settlement_partial_payment_enabled',
      true,
    );

    // Dedup: prevent same cleared doc from appearing twice in one SE
    const seenClearedIds = new Set<string>();
    for (const line of dto.lines) {
      if (seenClearedIds.has(line.clearedDocumentId)) {
        throw new BadRequestException(
          `เอกสาร ${line.clearedDocumentId} ปรากฏซ้ำในรายการ`,
        );
      }
      seenClearedIds.add(line.clearedDocumentId);
    }

    return this.prisma.$transaction(async (tx) => {
      // Acquire advisory locks in sorted order to prevent deadlock under concurrent
      // SEs targeting overlapping cleared docs.
      const sortedClearedIds = [...new Set(dto.lines.map((l) => l.clearedDocumentId))].sort();
      for (const clearedId of sortedClearedIds) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          clearedId,
        );
      }
      // Validate + load each cleared doc
      let sumSettled = new Prisma.Decimal(0);
      for (const line of dto.lines) {
        const cleared = await tx.expenseDocument.findUniqueOrThrow({
          where: { id: line.clearedDocumentId },
        });
        if (cleared.deletedAt) {
          throw new BadRequestException(`เอกสาร ${cleared.number} ถูกลบไปแล้ว`);
        }
        if (cleared.branchId !== dto.branchId) {
          throw new BadRequestException(`เอกสาร ${cleared.number} อยู่สาขาอื่น`);
        }
        if (cleared.documentType !== 'EXPENSE') {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} ไม่ใช่ใบรายจ่าย (EX)`,
          );
        }
        if (cleared.status !== 'ACCRUAL') {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} ไม่ได้อยู่ในสถานะ ACCRUAL (ขณะนี้: ${cleared.status})`,
          );
        }
        // Cap: amountSettled <= cleared.totalAmount minus prior settlements.
        // Only count POSTED SEs (DRAFT SEs not yet posted should not consume cap,
        // otherwise unposted drafts could starve other SEs from clearing the same doc).
        const priorAgg = await tx.settlementLine.aggregate({
          where: {
            clearedDocumentId: line.clearedDocumentId,
            settlement: {
              document: {
                status: 'POSTED',
                deletedAt: null,
              },
            },
          },
          _sum: { amountSettled: true },
        });
        const priorTotal = new Prisma.Decimal(priorAgg._sum.amountSettled ?? 0);
        const cap = new Prisma.Decimal(cleared.totalAmount.toString()).minus(priorTotal);
        const amount = new Prisma.Decimal(line.amountSettled);
        if (amount.gt(cap)) {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} จำนวนที่จ่ายเกินยอดที่ค้าง (เหลือ ${cap.toFixed(2)} ฿)`,
          );
        }
        // D1.3.6.3 — when partial-payment is disabled, every line must clear
        // the FULL remaining cap. `amount < cap` is the partial-payment
        // condition; allow ≤0.01 ฿ rounding slop just like the tolerance
        // policy elsewhere (BadRequestException is still the right call —
        // the user can edit the line amount and resubmit).
        if (!partialPaymentEnabled && cap.minus(amount).gt(new Prisma.Decimal('0.01'))) {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} ต้องชำระเต็มจำนวน (ค้าง ${cap.toFixed(2)} ฿) — ` +
              `การชำระบางส่วนถูกปิดในการตั้งค่าระบบ`,
          );
        }
        sumSettled = sumSettled.plus(amount);
      }

      const wht = new Prisma.Decimal(dto.withholdingTax ?? 0);
      if (wht.gt(sumSettled)) {
        throw new BadRequestException(
          `หัก ณ ที่จ่าย (${wht}) เกินยอดรวมที่จ่าย (${sumSettled})`,
        );
      }

      // B2 — V12/V13/V14 Multi-line Adjustment validation on SETTLEMENT.
      // Mirrors EXPENSE_SAMEDAY: when the actual cash leg (amountPaid) differs
      // from the expected `sumSettled − wht`, adjustments balance the gap.
      const netExpected = sumSettled.minus(wht);
      const amountPaid =
        dto.amountPaid !== undefined ? new Prisma.Decimal(dto.amountPaid) : netExpected;
      const adjustments = dto.adjustments ?? [];
      await validateAdjustments(tx, { adjustments, netExpected, amountPaid });

      const documentDate = new Date(dto.documentDate);
      const number = await this.docNumber.next(tx, 'VENDOR_SETTLEMENT', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'VENDOR_SETTLEMENT',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          // Party-master link (Phase 3 P3) — durable FK to the settled supplier.
          vendorSupplierId: dto.vendorSupplierId ?? null,
          description: dto.description ?? null,
          subtotal: sumSettled,
          vatAmount: new Prisma.Decimal(0),
          withholdingTax: wht,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: sumSettled,
          // netPayment = actual cash leg. With no adjustments this equals
          // `sumSettled − wht`; with adjustments it absorbs the signed delta.
          netPayment: amountPaid,
          depositAccountCode: dto.depositAccountCode,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: user.id,
          settlement: {
            create: {
              settlementLines: {
                create: dto.lines.map((l) => ({
                  clearedDocumentId: l.clearedDocumentId,
                  amountSettled: new Prisma.Decimal(l.amountSettled),
                })),
              },
            },
          },
          adjustments:
            adjustments.length > 0
              ? {
                  create: adjustments.map((a, idx) => ({
                    lineNo: idx + 1,
                    accountCode: a.accountCode,
                    side: a.side,
                    amount: new Prisma.Decimal(a.amount),
                    note: a.note ?? null,
                  })),
                }
              : undefined,
        },
        include: {
          settlement: { include: { settlementLines: true } },
          adjustments: { orderBy: { lineNo: 'asc' } },
        },
      });
    });
  }

  // ─── Petty Cash create (C1) — multi-supplier single-doc ──────────────
  async createPettyCash(
    dto: CreatePettyCashDto,
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    // D1.1.5.1 — feature flag gate. OWNER can disable Petty Cash entirely via
    // SystemConfig `petty_cash_enabled = false`. Default true (feature shipped
    // and active). Checked against PrismaService (not in $transaction) since
    // failure is a 400 long before any DB writes happen.
    const enabled = await this.readBoolFlag(this.prisma, 'petty_cash_enabled', true);
    if (!enabled) {
      throw new BadRequestException('ระบบเงินสดย่อยถูกปิดใช้งาน');
    }

    // Branch access — same rule as other doc types.
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

    const documentDate = new Date(dto.documentDate);
    const config = await this.pettyCash.getConfig();

    // Compute per-line totals + aggregate. Petty Cash uses EXCLUSIVE pricing
    // implicitly — `amount` is the pre-VAT base, `vatPercent` adds on top.
    const linesPrepared = dto.lines.map((l, idx) => {
      const base = new Prisma.Decimal(l.amount);
      const vatPct = new Prisma.Decimal(l.vatPercent ?? 0);
      const vat = base.times(vatPct).div(100).toDecimalPlaces(2);
      return {
        lineNo: idx + 1,
        category: l.category,
        description: l.description ?? null,
        supplierName: l.supplierName,
        // Party-master link (Phase 3 P3) — durable FK to the per-line supplier.
        supplierId: l.supplierId ?? null,
        quantity: new Prisma.Decimal(1),
        unitPrice: base,
        discount: new Prisma.Decimal(0),
        vatPercent: vatPct,
        whtPercent: new Prisma.Decimal(0),
        whtFormType: null,
        amountBeforeVat: base,
        vatAmount: vat,
        whtAmount: new Prisma.Decimal(0),
        taxInvoiceNo: l.taxInvoiceNo ?? null,
      };
    });

    const subtotal = linesPrepared.reduce(
      (s, l) => s.plus(l.amountBeforeVat),
      new Prisma.Decimal(0),
    );
    const vatTotal = linesPrepared.reduce(
      (s, l) => s.plus(l.vatAmount),
      new Prisma.Decimal(0),
    );
    const total = subtotal.plus(vatTotal);

    // V20 — Petty Cash invariants (total ≤ limit, supplier on every line, account match).
    this.pettyCash.validate(
      {
        total,
        depositAccountCode: dto.depositAccountCode,
        lines: dto.lines.map((l) => ({ supplierName: l.supplierName })),
      },
      config,
    );

    return this.prisma.$transaction(async (tx) => {
      // CoA validation — each category must exist + be type "ค่าใช้จ่าย"
      await assertCategoriesAreExpense(
        tx,
        linesPrepared.map((l) => l.category),
      );

      const number = await this.docNumber.next(tx, 'PETTY_CASH_REIMBURSEMENT', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'PETTY_CASH_REIMBURSEMENT',
          branchId: dto.branchId,
          documentDate,
          // Doc-level vendor stays null — supplier moves per-line.
          vendorName: dto.custodianName ?? null,
          description: dto.description ?? null,
          subtotal,
          vatAmount: vatTotal,
          withholdingTax: new Prisma.Decimal(0),
          whtFormType: null,
          totalAmount: total,
          netPayment: total,
          depositAccountCode: dto.depositAccountCode,
          paymentMethod: 'CASH',
          status: 'DRAFT',
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          createdById: user.id,
          expenseDetail: {
            create: {
              priceType: 'EXCLUSIVE',
              lines: {
                create: linesPrepared.map((l) => ({
                  lineNo: l.lineNo,
                  category: l.category,
                  description: l.description,
                  supplierName: l.supplierName,
                  supplierId: l.supplierId,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  vatPercent: l.vatPercent,
                  whtPercent: l.whtPercent,
                  whtFormType: l.whtFormType,
                  amountBeforeVat: l.amountBeforeVat,
                  vatAmount: l.vatAmount,
                  whtAmount: l.whtAmount,
                })),
              },
            },
          },
        },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        },
      });
    });
  }

  // ─── Update (DRAFT only) ─────────────────────────────────────────────
  async update(id: string, dto: UpdateExpenseDocumentDto, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { expenseDetail: { include: { lines: true } } },
      });
      if (existing.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      this.transition.assertCanEdit({ from: existing.status });

      const data: Prisma.ExpenseDocumentUpdateInput = {};
      if (dto.documentDate) data.documentDate = new Date(dto.documentDate);
      if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
      if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
      // Party-master link (Phase 3 P3) — set/clear the supplier FK on edit.
      if (dto.vendorSupplierId !== undefined) {
        data.vendorSupplier = dto.vendorSupplierId
          ? { connect: { id: dto.vendorSupplierId } }
          : { disconnect: true };
      }
      if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.whtFormType !== undefined) data.whtFormType = dto.whtFormType;
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod as never;
      if (dto.depositAccountCode !== undefined) data.depositAccountCode = dto.depositAccountCode;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.approvedById !== undefined) {
        data.approvedBy = dto.approvedById
          ? { connect: { id: dto.approvedById } }
          : { disconnect: true };
      }
      // Phase A.5 — accountants may flip the flag retroactively while a doc
      // is still editable (DRAFT/ACCRUAL). Persisted as plain Boolean.
      if (dto.taxDisallowed !== undefined) data.taxDisallowed = dto.taxDisallowed;

      if (dto.lines !== undefined) {
        const priceType = dto.priceType ?? existing.expenseDetail?.priceType ?? 'EXCLUSIVE';
        const linesPrepared = dto.lines.map((l, idx) => {
          const out = this.aggregator.computeLine(l, priceType as never);
          return { ...l, lineNo: idx + 1, ...out };
        });

        // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
        await assertCategoriesAreExpense(
          tx,
          linesPrepared.map((l) => l.category),
        );

        const totals = this.aggregator.aggregateLines(linesPrepared);

        data.subtotal = totals.subtotal;
        data.vatAmount = totals.vatAmount;
        data.withholdingTax = totals.withholdingTax;
        data.totalAmount = totals.totalAmount;
        data.netPayment = (dto.depositAccountCode ?? existing.depositAccountCode)
          ? totals.netPayment
          : null;

        // Replace lines wholesale — expenseDetailId FK = documentId
        await tx.expenseLine.deleteMany({ where: { expenseDetailId: id } });
        await tx.expenseDetail.update({
          where: { documentId: id },
          data: {
            priceType: priceType as string,
            lines: {
              create: linesPrepared.map((l) => ({
                lineNo: l.lineNo,
                category: l.category,
                description: l.description ?? null,
                quantity: new Prisma.Decimal(l.quantity),
                unitPrice: new Prisma.Decimal(l.unitPrice),
                discount: new Prisma.Decimal(l.discount ?? 0),
                vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                whtFormType: l.whtFormType ?? null,
                amountBeforeVat: l.amountBeforeVat,
                vatAmount: l.vatAmount,
                whtAmount: l.whtAmount,
                taxDisallowed: l.taxDisallowed ?? false,
              })),
            },
          },
        });
      }

      return tx.expenseDocument.update({
        where: { id },
        data,
        include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
      });
    });
  }
}
