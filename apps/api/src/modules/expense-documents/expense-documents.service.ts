import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { ExpenseSameDayTemplate } from '../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../journal/cpa-templates/vendor-settlement.template';
import { PettyCashTemplate } from '../journal/cpa-templates/petty-cash.template';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { CreatePettyCashDto } from './dto/create-petty-cash.dto';
import { VoidExpenseDocumentDto } from './dto/void-expense.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { LineAggregatorService } from './services/line-aggregator.service';
import { JePreviewService } from './services/je-preview.service';
import { SsoConfigService } from '../sso-config/sso-config.service';
import { PettyCashService } from './services/petty-cash.service';
import { PayrollCustomService } from './services/payroll-custom.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';

/**
 * Allow-list of account codes that may appear on a multi-line Adjustment row
 * (W1 hardening). The adjustment rows absorb cash-leg deltas between
 * amount_paid and (totalAmount − wht); only small-amount tolerance / bank-fee
 * / discount accounts are sensible here. Allowing arbitrary CoA codes lets the
 * preparer pick Revenue or Cash, balancing the JE but causing accounting drift.
 *
 * Codes from accounting.md FINANCE chart (apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv):
 *   52-1104 — ส่วนลดเศษสตางค์ (≤1฿ rounding tolerance)
 *   52-1106 — ส่วนลดดอกเบี้ย-ปิดยอด (Early payoff discount)
 *   53-1303 — ค่าธรรมเนียมธนาคาร
 *   53-1503 — กำไร/ขาดทุนจากการปัดเศษ
 */
const ADJUSTMENT_ALLOWLIST = new Set<string>([
  '52-1104',
  '52-1106',
  '53-1303',
  '53-1503',
]);

/**
 * Returns a Date representing 12:00 noon Asia/Bangkok on the same calendar day
 * as `now`. Used as a stable `postedAt` for journal entries that should land
 * on the BKK business day regardless of the server's UTC clock — without this,
 * a void after 17:00 BKK (= next UTC day) would post in the wrong accounting period.
 */
function bkkBusinessDate(now: Date): Date {
  const ymd = now.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // ymd is "YYYY-MM-DD" in BKK; build noon BKK = 05:00 UTC of the same date
  return new Date(`${ymd}T05:00:00.000Z`);
}

@Injectable()
export class ExpenseDocumentsService implements OnModuleInit {
  private readonly logger = new Logger(ExpenseDocumentsService.name);

  /**
   * W1 (Round 2) — Boot-time validation that every ADJUSTMENT_ALLOWLIST code
   * actually exists (active, not deleted) in chart_of_accounts. Pattern
   * mirrors AccountRoleService.assertCodesExistInCoa. Without this, a CoA
   * rename or soft-delete would let the allow-list silently reference a
   * dead account and a preparer could still pick it. Boot fails loud so
   * the drift is caught before the first doc posts.
   */
  async onModuleInit(): Promise<void> {
    const codes = [...ADJUSTMENT_ALLOWLIST];
    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map((c) => c.code));
    const missing = codes.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      throw new Error(
        `ExpenseDocumentsService: ADJUSTMENT_ALLOWLIST references ` +
          `${missing.length} code(s) not present (or soft-deleted) in ` +
          `chart_of_accounts: ${missing.join(', ')}. Either seed the ` +
          `accounts or update the allow-list constant.`,
      );
    }
    this.logger.log(
      `[W1] Adjustment allow-list verified: ${codes.length} codes present in CoA`,
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly transition: StatusTransitionService,
    private readonly sameDayTemplate: ExpenseSameDayTemplate,
    private readonly accrualTemplate: ExpenseAccrualTemplate,
    private readonly creditNoteTemplate: CreditNoteTemplate,
    private readonly payrollTemplate: PayrollTemplate,
    private readonly settlementTemplate: VendorSettlementTemplate,
    private readonly journal: JournalAutoService,
    private readonly aggregator: LineAggregatorService,
    private readonly jePreview: JePreviewService,
    private readonly ssoConfig: SsoConfigService,
    private readonly pettyCashTemplate: PettyCashTemplate,
    private readonly pettyCash: PettyCashService,
    private readonly payrollCustom: PayrollCustomService,
  ) {}

  // ─── D1.* — Service-side SystemConfig flag readers ─────────────────────
  // Read directly via PrismaService (avoids injecting SettingsService for a
  // single-key lookup; also sidesteps potential audit↔settings circular dep
  // pattern when this service is consumed by future audit-linked features).
  // Each helper returns the spec-defined default if the SystemConfig row is
  // missing or has an unparseable value, so first-boot behavior is preserved.
  private async readBoolFlag(
    tx: Prisma.TransactionClient | PrismaService,
    key: string,
    fallback: boolean,
  ): Promise<boolean> {
    try {
      const row = await tx.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return fallback;
      const v = row.value.trim().toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      return fallback;
    } catch {
      return fallback;
    }
  }

  // ─── V12/V13/V14 — Multi-line Adjustment validation (shared) ────────
  // Fix Report P0-4 + B2. Validates that:
  //   V12  Σ signed(adjustments) === amountPaid − netExpected
  //   V13  every accountCode exists in CoA and is on ADJUSTMENT_ALLOWLIST
  //   V14  every row.amount > 0 and accountCode is non-empty
  // Signed convention: CR contributes +amount, DR contributes −amount.
  private async validateAdjustments(
    tx: Prisma.TransactionClient,
    opts: {
      adjustments: { accountCode: string; side: 'DR' | 'CR'; amount: string | number; note?: string }[];
      netExpected: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
    },
  ): Promise<void> {
    const { adjustments, netExpected, amountPaid } = opts;
    const diff = amountPaid.minus(netExpected);

    if (adjustments.length === 0 && diff.eq(0)) return; // fast path — no adjustments needed

    // V14 — non-empty accountCode + positive amount
    for (let i = 0; i < adjustments.length; i++) {
      const a = adjustments[i];
      if (!a.accountCode || !a.accountCode.trim()) {
        throw new BadRequestException(`V13: บัญชีปรับผลต่างแถวที่ ${i + 1} ยังไม่ได้เลือกบัญชี`);
      }
      const amt = new Prisma.Decimal(a.amount);
      if (amt.lte(0)) {
        throw new BadRequestException(
          `V14: บัญชีปรับผลต่างแถวที่ ${i + 1}: จำนวนต้องมากกว่า 0`,
        );
      }
    }

    // V13 — code exists in CoA AND on the allow-list
    if (adjustments.length > 0) {
      const adjCodes = [...new Set(adjustments.map((a) => a.accountCode))];
      const adjCoaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: adjCodes }, deletedAt: null },
        select: { code: true },
      });
      const adjFound = new Set(adjCoaRows.map((r) => r.code));
      for (const c of adjCodes) {
        if (!adjFound.has(c)) {
          throw new BadRequestException(`V13: บัญชีปรับผลต่าง ${c} ไม่พบในผังบัญชี`);
        }
        if (!ADJUSTMENT_ALLOWLIST.has(c)) {
          throw new BadRequestException(
            `V13: บัญชีปรับผลต่าง ${c} ไม่อยู่ในรายการที่อนุญาต — ` +
              `อนุญาตเฉพาะ ${[...ADJUSTMENT_ALLOWLIST].join(', ')}`,
          );
        }
      }
    }

    // V12 — Σ signed(adjustments) === diff
    const signedSum = adjustments.reduce<Prisma.Decimal>((s, a) => {
      const amt = new Prisma.Decimal(a.amount);
      return a.side === 'CR' ? s.plus(amt) : s.minus(amt);
    }, new Prisma.Decimal(0));
    if (!signedSum.eq(diff)) {
      throw new BadRequestException(
        `V12: ผลรวมบัญชีปรับผลต่าง (signed = ${signedSum.toFixed(2)}) ` +
          `ไม่เท่ากับผลต่าง amount_paid − net_expected (${diff.toFixed(2)})`,
      );
    }
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
      const codes = [...new Set(linesPrepared.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        const t = byCode.get(c);
        if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
        if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
      }

      // Fix Report P0-4 — multi-line adjustment validation (V12/V13/V14).
      // Shared helper used here (EXPENSE) and by createSettlement (B2 / SE).
      const totalAmount = new Prisma.Decimal(totals.totalAmount.toString());
      const wht = new Prisma.Decimal(totals.withholdingTax.toString());
      const netExpected = totalAmount.minus(wht);
      const amountPaid =
        dto.amountPaid !== undefined ? new Prisma.Decimal(dto.amountPaid) : netExpected;
      const adjustments = dto.adjustments ?? [];
      await this.validateAdjustments(tx, { adjustments, netExpected, amountPaid });

      const number = await this.docNumber.next(tx, 'EXPENSE', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          vendorTaxId: dto.vendorTaxId ?? null,
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
      const codes = [...new Set(linesPrepared.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        const t = byCode.get(c);
        if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
        if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
      }

      // LINKED-mode validation: source lookup + cap + WHT guard under advisory lock.
      // STANDALONE-mode skips this — there is no source document.
      let originalVendorName: string | null = null;
      let originalVendorTaxId: string | null = null;
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

    // Compute netPaid per line + validate
    const preparedRows = await Promise.all(
      dto.lines.map(async (l) => {
        const base = new Prisma.Decimal(l.baseSalary);
        const sso = new Prisma.Decimal(l.ssoEmployee ?? 0);
        const wht = new Prisma.Decimal(l.whtAmount ?? 0);
        // C2 — V16/V17/V18 validators + taxableBase result (not used here yet;
        // exposed for future automatic-WHT-compute consumers).
        await this.payrollCustom.validateLine(
          {
            employeeName: l.employeeName,
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
            `พนักงาน "${l.employeeName}" — เงินสุทธิติดลบ ` +
              `(ฐาน ${base} + รายได้พิเศษ ${sumIncome} - SSO ${sso} - WHT ${wht} - หัก ${sumDeduction})`,
          );
        }
        return {
          employeeName: l.employeeName,
          employeeTaxId: l.employeeTaxId ?? null,
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
    return this.prisma.$transaction(async (tx) => {
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
  }

  // ─── Vendor Settlement create — multi-line clears ACCRUAL EXs ────────
  async createSettlement(
    dto: CreateSettlementDto,
    user: { id: string; branchId?: string | null; role?: string },
  ) {
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

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
      await this.validateAdjustments(tx, { adjustments, netExpected, amountPaid });

      const documentDate = new Date(dto.documentDate);
      const number = await this.docNumber.next(tx, 'VENDOR_SETTLEMENT', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'VENDOR_SETTLEMENT',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
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
      const codes = [...new Set(linesPrepared.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        const t = byCode.get(c);
        if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
        if (t !== 'ค่าใช้จ่าย') {
          throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
        }
      }

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

  // ─── List ────────────────────────────────────────────────────────────
  async list(
    query: ListExpenseDocumentsQueryDto,
    user: { branchId?: string | null; role?: string },
  ) {
    const where: Prisma.ExpenseDocumentWhereInput = { deletedAt: null };

    // Branch scoping: cross-branch roles can pass ?branchId or omit it for "all";
    // non-cross-branch users are PINNED to their assigned branch — the query
    // param is ignored. If a non-cross-branch user has no branchId assigned
    // (data corruption), reject rather than fall through to query.branchId.
    if (hasCrossBranchAccess(user)) {
      if (query.branchId) where.branchId = query.branchId;
    } else {
      if (!user.branchId) {
        throw new ForbiddenException('ผู้ใช้ไม่มีสาขาที่ได้รับมอบหมาย');
      }
      where.branchId = user.branchId;
    }

    // Tab translation
    switch (query.tab) {
      case 'draft':
        where.status = 'DRAFT';
        break;
      case 'unpaid':
        where.status = 'ACCRUAL';
        break;
      case 'recorded':
        where.status = { in: ['ACCRUAL', 'POSTED'] };
        break;
      case 'paid':
        where.paidAt = { not: null };
        break;
      default:
        where.status = { not: 'VOIDED' };
    }

    // Explicit status overrides tab
    if (query.status) where.status = query.status as DocumentStatus;
    if (query.type) where.documentType = query.type as never;

    // Date range on documentDate
    if (query.startDate || query.endDate) {
      where.documentDate = {};
      if (query.startDate) where.documentDate.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    // Filter by ExpenseLine.category (e.g. CoA code "53-1302")
    if (query.category) {
      where.expenseDetail = { lines: { some: { category: query.category } } };
    }

    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { vendorName: { contains: query.search, mode: 'insensitive' } },
        { taxInvoiceNo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const [data, total] = await Promise.all([
      this.prisma.expenseDocument.findMany({
        where,
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { documentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseDocument.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Summary aggregations ────────────────────────────────────────────
  async getSummary(filters: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: { not: 'VOIDED' },
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.documentDate = {};
      if (filters.startDate) where.documentDate.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    // Server-side aggregation — does not load full rows into memory.
    const [totalCount, statusGroups, accrualUnpaid] = await Promise.all([
      this.prisma.expenseDocument.count({ where }),
      this.prisma.expenseDocument.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.expenseDocument.aggregate({
        where: { ...where, status: 'ACCRUAL', paidAt: null },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;

    return {
      totalCount,
      byStatus,
      accrualUnpaidCount: accrualUnpaid._count._all,
      // Decimal serialized as string ("1234.56") for parity with daily-summary
      // grandTotal — clients should parse for display rather than trusting JS float.
      accrualUnpaidTotal: accrualUnpaid._sum.totalAmount?.toFixed(2) ?? '0.00',
    };
  }

  /**
   * AP Aging — Fix Report P1-1.
   *
   * Returns ACCRUAL (unpaid) expenses bucketed by age since `documentDate`,
   * plus their per-bucket sums. Used by the APAgingPage with optional vendor /
   * bucket filters.
   *
   * Buckets (per Fix Report §1.3 P1-1):
   *   0-30 / 31-60 / 61-90 / 90+ days overdue
   *
   * Age is computed against "today BKK" (start-of-day) so a vendor's row that
   * just crossed midnight in Asia/Bangkok doesn't shift bucket vs server-tz.
   */
  async getApAging(filters: { branchId?: string; vendor?: string; bucket?: '0-30' | '31-60' | '61-90' | '90+' }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: 'ACCRUAL',
      paidAt: null,
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.vendor) {
      where.vendorName = { contains: filters.vendor, mode: 'insensitive' };
    }

    // W2 fix — age in calendar days, computed on BKK date strings.
    // Previous implementation took (todayBkkStart UTC ms − documentDate UTC ms)
    // / 86_400_000 and floored. Because documentDate stores UTC midnight (00:00Z
    // = 07:00 BKK same day) while todayBkkStart was UTC minus 7h (=BKK midnight
    // mapped to 17:00Z previous UTC day), the ms-diff was non-integer around
    // the boundary, so floor() shifted some rows by ±1 day (e.g. a doc dated
    // today appeared as 1 day old, pushing it from 0-30 to 31-60 right at
    // 17:00 BKK / 30 days later). Switch to calendar-day diff on YYYY-MM-DD
    // strings instead.
    const toBkkDate = (d: Date): string =>
      d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const todayBkkStr = toBkkDate(new Date());
    const daysBetween = (a: string, b: string): number => {
      // a, b are 'YYYY-MM-DD'. Build UTC midnights and subtract — exact integer
      // because both sides are at the same UTC hour.
      const [ay, am, ad] = a.split('-').map(Number);
      const [by, bm, bd] = b.split('-').map(Number);
      const aMs = Date.UTC(ay, am - 1, ad);
      const bMs = Date.UTC(by, bm - 1, bd);
      return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
    };

    const rows = await this.prisma.expenseDocument.findMany({
      where,
      select: {
        id: true,
        number: true,
        vendorName: true,
        vendorTaxId: true,
        documentDate: true,
        totalAmount: true,
        withholdingTax: true,
        branchId: true,
      },
      orderBy: { documentDate: 'asc' },
    });

    type Bucket = '0-30' | '31-60' | '61-90' | '90+';
    const toBucket = (ageDays: number): Bucket => {
      if (ageDays <= 30) return '0-30';
      if (ageDays <= 60) return '31-60';
      if (ageDays <= 90) return '61-90';
      return '90+';
    };

    const enriched = rows.map((r) => {
      const docBkkStr = toBkkDate(new Date(r.documentDate));
      const ageDays = Math.max(0, daysBetween(docBkkStr, todayBkkStr));
      return { ...r, ageDays, bucket: toBucket(ageDays) };
    });

    const filtered = filters.bucket ? enriched.filter((r) => r.bucket === filters.bucket) : enriched;

    const zero = new Prisma.Decimal(0);
    const totals: Record<Bucket | 'TOTAL', { count: number; amount: Prisma.Decimal }> = {
      '0-30': { count: 0, amount: new Prisma.Decimal(0) },
      '31-60': { count: 0, amount: new Prisma.Decimal(0) },
      '61-90': { count: 0, amount: new Prisma.Decimal(0) },
      '90+': { count: 0, amount: new Prisma.Decimal(0) },
      TOTAL: { count: 0, amount: new Prisma.Decimal(0) },
    };
    // Bucket totals use the full unfiltered set so the user can see context even
    // when bucket filter is active.
    for (const r of enriched) {
      const amt = new Prisma.Decimal(r.totalAmount.toString()).minus(
        new Prisma.Decimal(r.withholdingTax?.toString() ?? '0'),
      );
      totals[r.bucket].count += 1;
      totals[r.bucket].amount = totals[r.bucket].amount.plus(amt);
      totals.TOTAL.count += 1;
      totals.TOTAL.amount = totals.TOTAL.amount.plus(amt);
    }
    void zero;

    return {
      buckets: {
        '0-30': { count: totals['0-30'].count, amount: totals['0-30'].amount.toFixed(2) },
        '31-60': { count: totals['31-60'].count, amount: totals['31-60'].amount.toFixed(2) },
        '61-90': { count: totals['61-90'].count, amount: totals['61-90'].amount.toFixed(2) },
        '90+': { count: totals['90+'].count, amount: totals['90+'].amount.toFixed(2) },
        TOTAL: { count: totals.TOTAL.count, amount: totals.TOTAL.amount.toFixed(2) },
      },
      docs: filtered.map((r) => ({
        id: r.id,
        number: r.number,
        vendorName: r.vendorName,
        vendorTaxId: r.vendorTaxId,
        documentDate: r.documentDate.toISOString(),
        ageDays: r.ageDays,
        bucket: r.bucket,
        // Net amount = totalAmount − wht (the cash leg pending payment).
        netAmount: new Prisma.Decimal(r.totalAmount.toString())
          .minus(new Prisma.Decimal(r.withholdingTax?.toString() ?? '0'))
          .toFixed(2),
        branchId: r.branchId,
      })),
    };
  }

  // ─── Daily summary (print-ready aggregation) ─────────────────────────
  async getDailySummary(
    filters: { date: string; branchId?: string },
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    const branchId = hasCrossBranchAccess(user)
      ? filters.branchId
      : (user.branchId ?? filters.branchId);
    if (!branchId) {
      throw new BadRequestException('ต้องระบุสาขา');
    }
    const start = new Date(filters.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.date);
    end.setHours(23, 59, 59, 999);

    const documents = await this.prisma.expenseDocument.findMany({
      where: {
        branchId,
        documentDate: { gte: start, lte: end },
        status: { not: 'VOIDED' },
        deletedAt: null,
      },
      include: {
        // I4 fix — pull ALL expense lines (not just the first) so the
        // "by category" aggregation reflects every line's category, weighted
        // by amountBeforeVat. Previously `take: 1` made multi-line docs all
        // collapse to their first line's category — a 3-line doc with 1k of
        // category A and 2x 5k of B would attribute all 11k to A. With this
        // include the daily summary instead sums per-line amounts into the
        // right buckets.
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        creditNote: true,
        payroll: true,
        settlement: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { number: 'asc' },
    });

    // Aggregate
    const byType: Record<string, { count: number; total: string }> = {};
    const byPaymentMethod: Record<string, { count: number; total: string }> = {};
    const byCategory: Record<string, { count: number; total: string }> = {};
    const cashMovement: Record<string, { out: string; count: number }> = {};

    let grandTotal = new Prisma.Decimal(0);

    for (const d of documents) {
      const total = new Prisma.Decimal(d.totalAmount.toString());
      grandTotal = grandTotal.plus(total);

      // By type
      const tKey = d.documentType;
      const tBucket = byType[tKey] ?? { count: 0, total: '0' };
      tBucket.count++;
      tBucket.total = new Prisma.Decimal(tBucket.total).plus(total).toFixed(2);
      byType[tKey] = tBucket;

      // By payment method (only if doc has paymentMethod set)
      if (d.paymentMethod) {
        const mKey = d.paymentMethod;
        const mBucket = byPaymentMethod[mKey] ?? { count: 0, total: '0' };
        mBucket.count++;
        const netAmt = d.netPayment ? new Prisma.Decimal(d.netPayment.toString()) : total;
        mBucket.total = new Prisma.Decimal(mBucket.total).plus(netAmt).toFixed(2);
        byPaymentMethod[mKey] = mBucket;
      }

      // I4 — By category: sum per-line amounts into category buckets so a
      // multi-line doc contributes correctly to each category. count uses
      // 1 per distinct category in the doc (not per line) so a doc with
      // 3 cleaning lines counts once for "cleaning", not three times.
      // Defensive: legacy rows without `amountBeforeVat` (data migration
      // artefacts) fall back to 0 — they still count toward the bucket's
      // doc count but contribute no value.
      const lines =
        (d as { expenseDetail?: { lines?: { category: string; amountBeforeVat?: unknown }[] } | null })
          .expenseDetail?.lines ?? [];
      const seenInDoc = new Set<string>();
      for (const l of lines) {
        const cat = l.category;
        const raw = l.amountBeforeVat;
        const lineAmt = raw != null ? new Prisma.Decimal(raw.toString()) : new Prisma.Decimal(0);
        const cBucket = byCategory[cat] ?? { count: 0, total: '0' };
        if (!seenInDoc.has(cat)) {
          cBucket.count++;
          seenInDoc.add(cat);
        }
        cBucket.total = new Prisma.Decimal(cBucket.total).plus(lineAmt).toFixed(2);
        byCategory[cat] = cBucket;
      }

      // Cash movement (only docs with depositAccountCode + paidAt today)
      if (d.depositAccountCode && d.paidAt && d.paidAt >= start && d.paidAt <= end) {
        const aKey = d.depositAccountCode;
        const aBucket = cashMovement[aKey] ?? { out: '0', count: 0 };
        const netAmt = d.netPayment ? new Prisma.Decimal(d.netPayment.toString()) : total;
        aBucket.out = new Prisma.Decimal(aBucket.out).plus(netAmt).toFixed(2);
        aBucket.count++;
        cashMovement[aKey] = aBucket;
      }
    }

    return {
      date: filters.date,
      branchId,
      branchName: documents[0]?.branch?.name ?? null,
      documents,
      grandTotal: grandTotal.toFixed(2),
      byType,
      byPaymentMethod,
      byCategory,
      cashMovement,
    };
  }

  // ─── Credit-Note remaining cap ───────────────────────────────────────
  // Returns how much CN can still be issued against this original document.
  // cap = original.totalAmount - Σ (non-VOIDED CNs against this original).
  async getCreditNoteCap(originalDocumentId: string) {
    const original = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id: originalDocumentId },
    });
    if (original.deletedAt) {
      throw new NotFoundException('เอกสารต้นฉบับถูกลบแล้ว');
    }
    if (original.documentType !== 'EXPENSE') {
      throw new BadRequestException('ใบลดหนี้ใช้ลดเอกสารรายจ่ายเท่านั้น');
    }
    const priorAgg = await this.prisma.expenseDocument.aggregate({
      where: {
        documentType: 'CREDIT_NOTE',
        status: { not: 'VOIDED' },
        deletedAt: null,
        creditNote: { originalDocumentId },
      },
      _sum: { totalAmount: true },
    });
    const used = new Prisma.Decimal(priorAgg._sum.totalAmount ?? 0);
    const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(used);
    return {
      originalTotal: original.totalAmount.toString(),
      usedTotal: used.toString(),
      remainingCap: cap.toString(),
    };
  }

  // ─── JE Preview (pure — no DB write) ────────────────────────────────
  async previewJe(dto: CreateExpenseDocumentDto) {
    const codes = new Set<string>();
    for (const l of dto.lines) codes.add(l.category);
    if (dto.depositAccountCode) codes.add(dto.depositAccountCode);
    // W8 — preload adjustment row codes + per-line WHT routes so the preview
    // can resolve names for the new sections (adjustments + multi-line WHT).
    for (const adj of dto.adjustments ?? []) {
      if (adj.accountCode) codes.add(adj.accountCode);
    }
    // 11-4101 = ภาษีซื้อ (Input Tax Credit, claimable). Mirrors expense
    // templates' VAT routing — must match what post() actually books.
    codes.add('11-4101');
    codes.add('21-1104');
    // Always preload both WHT routes — the preview may emit either or both
    // depending on per-line whtFormType (P2-4).
    codes.add('21-3102');
    codes.add('21-3103');

    const rows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: [...codes] }, deletedAt: null },
      select: { code: true, name: true },
    });
    const accountNames = new Map(rows.map((r) => [r.code, r.name]));
    return this.jePreview.preview(dto, accountNames);
  }

  // ─── Find one ────────────────────────────────────────────────────────
  // I5 — include type-specific detail so single-doc views (PaymentVoucher,
  // CN view, payroll view, SE view) don't need a follow-up roundtrip. The
  // base includes (expenseDetail / branch / approver) work for every type;
  // creditNote / payroll / settlement detail are added based on documentType.
  async findOne(id: string) {
    // First pass to read documentType, then a typed include.
    const docType = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      select: { documentType: true, deletedAt: true },
    });
    if (docType.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');

    const doc = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: {
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        adjustments: { orderBy: { lineNo: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        // Conditional includes by documentType — Prisma allows boolean here
        // and noop when the relation row doesn't exist for the type.
        creditNote: docType.documentType === 'CREDIT_NOTE',
        payroll:
          docType.documentType === 'PAYROLL'
            ? {
                include: {
                  lines: {
                    include: {
                      customIncome: { orderBy: { createdAt: 'asc' } },
                      customDeduction: { orderBy: { createdAt: 'asc' } },
                    },
                  },
                },
              }
            : false,
        settlement:
          docType.documentType === 'VENDOR_SETTLEMENT'
            ? { include: { settlementLines: true } }
            : false,
      },
    });
    if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
    return doc;
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

      if (dto.lines !== undefined) {
        const priceType = dto.priceType ?? existing.expenseDetail?.priceType ?? 'EXCLUSIVE';
        const linesPrepared = dto.lines.map((l, idx) => {
          const out = this.aggregator.computeLine(l, priceType as never);
          return { ...l, lineNo: idx + 1, ...out };
        });

        // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
        const codes = [...new Set(linesPrepared.map((l) => l.category))];
        const coaRows = await tx.chartOfAccount.findMany({
          where: { code: { in: codes }, deletedAt: null },
          select: { code: true, type: true },
        });
        const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
        for (const c of codes) {
          const t = byCode.get(c);
          if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
          if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
        }

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

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  async post(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Per-doc advisory lock — serializes concurrent post calls on the same id.
      // Without this, two callers could both read DRAFT, both pass assertCanPost,
      // and both run the JE template → two journal entries for one document
      // (same race class as voidDocument).
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      this.transition.assertCanPost({
        type: doc.documentType,
        from: doc.status,
        hasPaymentMethod: !!doc.paymentMethod && !!doc.depositAccountCode,
        totalAmount: doc.totalAmount.toString(),
      });

      // Fix #C9 (Round 2 — moved from journal-auto.service.createAndPost):
      // Period-open guard at the module boundary. Previously the guard lived
      // inside createAndPost, which broke payment + contract atomicity (it
      // would reject mid-tx JE writes and roll back the Payment record).
      // The guard belongs HERE because:
      //   1. We know the canonical posting date — doc.documentDate, not
      //      "now" (which would let a backdated post slip through if the
      //      clock crossed midnight between create + post).
      //   2. We know the canonical companyId — SHOP (all expense flows post
      //      SHOP-side per accounting.md §VAT Policy; expense template
      //      resolves SHOP later, this guard mirrors that).
      // Resolve SHOP companyId once via tx + cache; re-using the same
      // pattern as expense templates' getShopCompanyId.
      const shopForPeriod = await tx.companyInfo.findFirst({
        where: { companyCode: 'SHOP', deletedAt: null },
        select: { id: true },
      });
      if (!shopForPeriod) {
        throw new NotFoundException(
          'CompanyInfo with companyCode=SHOP not found — seed accounting data first',
        );
      }
      // documentDate is required on the schema but defend against legacy
      // rows with NULL via fallback to "now" (matches receipts.service +
      // payments.service behavior — neither has a per-row date column on
      // the doc, both pass new Date()).
      const periodDate = doc.documentDate ?? new Date();
      await validatePeriodOpen(tx, periodDate, shopForPeriod.id);

      // Fix #C10 — attachment threshold enforced server-side.
      // ATTACHMENT_REQUIRED_ABOVE_AMOUNT is set in /settings#attachment but
      // was previously only enforced by the frontend submit button. A direct
      // API call could POST a 500k expense with no receiptImageUrl → tax-audit
      // risk. Defense in depth: re-check at post() before any JE is written.
      const thresholdCfg = await tx.systemConfig.findUnique({
        where: { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT' },
      });
      const rawThreshold = thresholdCfg?.value ?? '0';
      const threshold = new Prisma.Decimal(
        Number.isFinite(Number(rawThreshold)) ? rawThreshold : '0',
      );
      const docTotal = new Prisma.Decimal(doc.totalAmount.toString());
      if (threshold.gt(0) && docTotal.gte(threshold) && !doc.receiptImageUrl) {
        throw new BadRequestException(
          `เอกสารยอด ${docTotal.toFixed(2)} บาท ต้องแนบไฟล์ประกอบ (เกณฑ์ ${threshold.toFixed(2)} บาท)`,
        );
      }

      // EXPENSE + CREDIT_NOTE + PAYROLL + VENDOR_SETTLEMENT supported
      if (!['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'].includes(doc.documentType)) {
        throw new BadRequestException(`type ${doc.documentType} not supported`);
      }

      // Fix #C12 — WHT routing invariant. When the doc has WHT > 0, doc.whtFormType
      // MUST be non-null (and a recognised form). Previously the JE template silently
      // defaulted to PND3 → routed to 21-3102, misfiling juristic-vendor WHT under
      // ภ.ง.ด.3 instead of ภ.ง.ด.53 (government compliance bug).
      //
      // C12-symmetry (this PR): mirror the guard across all 4 doc types so any
      // future bypass surfaces at post() instead of being silently misrouted by
      // the template. Each doc type carries WHT differently:
      //   - EXPENSE: doc.whtFormType OR every ExpenseLine.whtFormType is set
      //     (per-line routing — P2-4)
      //   - PAYROLL: doc.withholdingTax > 0 → always Cr 21-3101 (ภ.ง.ด.1) —
      //     payroll WHT is employee income tax, NOT PND3/PND53, so no formType
      //     enforcement here (BUT we still require it to be null since the field
      //     is meaningless for payroll)
      //   - VENDOR_SETTLEMENT: single-vendor invariant means doc-level form type
      //     applies (intentionally no per-line routing per accounting.md)
      //   - CREDIT_NOTE: createCreditNote already blocks original-with-WHT
      //     (so CN itself ideally has no WHT), but if the original had WHT and
      //     this branch is reached, we still need doc-level formType
      const wht = new Prisma.Decimal(doc.withholdingTax?.toString() ?? '0');
      if (wht.gt(0)) {
        if (doc.documentType === 'EXPENSE') {
          if (!doc.whtFormType) {
            // Check if every WHT-bearing line has its own form type → fall through to
            // per-line routing in the template. Otherwise the doc-level is mandatory.
            const detail = await tx.expenseDetail.findUnique({
              where: { documentId: id },
              include: { lines: true },
            });
            const whtLines = (detail?.lines ?? []).filter(
              (l) => l.whtAmount && new Prisma.Decimal(l.whtAmount.toString()).gt(0),
            );
            const allLinesHaveFormType =
              whtLines.length > 0 && whtLines.every((l) => !!l.whtFormType);
            if (!allLinesHaveFormType) {
              throw new BadRequestException(
                'whtFormType ต้องระบุเมื่อมี WHT — เลือก PND3 หรือ PND53',
              );
            }
            // If every line has a form type, validate each is PND3/PND53 (no other strings)
            for (const l of whtLines) {
              if (l.whtFormType !== 'PND3' && l.whtFormType !== 'PND53') {
                throw new BadRequestException(
                  `whtFormType ของบรรทัด ${(l as { lineNo?: number }).lineNo ?? '?'} ` +
                    `ต้องเป็น PND3 หรือ PND53 (พบ ${l.whtFormType ?? 'null'})`,
                );
              }
            }
          } else if (doc.whtFormType !== 'PND3' && doc.whtFormType !== 'PND53') {
            throw new BadRequestException(
              `whtFormType ต้องเป็น PND3 หรือ PND53 (พบ ${doc.whtFormType})`,
            );
          }
        } else if (doc.documentType === 'VENDOR_SETTLEMENT' || doc.documentType === 'CREDIT_NOTE') {
          // Per-line routing intentionally NOT supported for SE (single-vendor
          // invariant per accounting.md) and CN (template routes by original.whtFormType
          // since CN itself carries no WHT — but defense in depth).
          if (!doc.whtFormType) {
            throw new BadRequestException(
              'whtFormType ต้องระบุเมื่อมี WHT — เลือก PND3 หรือ PND53',
            );
          }
          if (doc.whtFormType !== 'PND3' && doc.whtFormType !== 'PND53') {
            throw new BadRequestException(
              `whtFormType ต้องเป็น PND3 หรือ PND53 (พบ ${doc.whtFormType})`,
            );
          }
        }
        // PAYROLL: doc.whtFormType is meaningless (employee income tax always
        // routes to 21-3101 / ภ.ง.ด.1). No enforcement — payroll.template
        // posts to 21-3101 unconditionally when sumWht > 0.
      }

      if (doc.documentType === 'CREDIT_NOTE') {
        return this.creditNoteTemplate.execute(id, tx);
      }
      if (doc.documentType === 'PAYROLL') {
        return this.payrollTemplate.execute(id, tx);
      }
      if (doc.documentType === 'VENDOR_SETTLEMENT') {
        return this.settlementTemplate.execute(id, tx);
      }
      if (doc.documentType === 'PETTY_CASH_REIMBURSEMENT') {
        return this.pettyCashTemplate.execute(id, tx);
      }
      const target = this.transition.resolveTargetStatus(
        doc.documentType,
        !!doc.paymentMethod && !!doc.depositAccountCode,
      );
      if (target === 'POSTED') {
        return this.sameDayTemplate.execute(id, tx);
      } else {
        // V15 — ACCRUAL ห้ามมี WHT (ม.50 ป.รัษฎากร).
        // WHT เกิด "ขณะที่จ่ายเงินได้" → ACCRUAL is the accrual leg before
        // payment, so WHT must defer to the SETTLEMENT step. Booking WHT now
        // would put it in the wrong tax period and cause ภงด.53 misfile.
        // Fix Report P0-2.
        if (doc.withholdingTax && doc.withholdingTax.gt(0)) {
          throw new BadRequestException(
            'V15: เอกสารตั้งหนี้ (ACCRUAL) ห้ามมี WHT (มาตรา 50 ป.รัษฎากร) — ' +
              'WHT จะถูกบันทึกตอน Settlement เมื่อจ่ายเงินจริง',
          );
        }
        return this.accrualTemplate.execute(id, tx);
      }
    });
  }

  // ─── Void (any non-VOIDED → VOIDED) ──────────────────────────────────
  // Posts a reversal JE (flipped Dr/Cr) when the doc had a journal entry,
  // and for VENDOR_SETTLEMENT also reverts each cleared EX back to ACCRUAL.
  // C3 — Optionally accepts reasonCode + reasonDetail + reverseDate (caller-chosen
  // posting date for the reversal JE). All optional → existing parameterless
  // void path still works (back-compat).
  async voidDocument(id: string, userId: string, dto: VoidExpenseDocumentDto = {}) {
    return this.prisma.$transaction(async (tx) => {
      // Per-doc advisory lock — serializes concurrent voids on the same id so
      // two callers cannot both pass assertCanVoid and double-post a reversal JE.
      // (PG REPEATABLE READ does not prevent this write skew on its own.)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `void:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { settlement: { include: { settlementLines: true } } },
      });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');

      // D1.2.7.4 — `reverse_block_cascaded` (default true). OWNER may disable
      // via SystemConfig to allow voiding upstream docs even when downstream CN/SE
      // exist. Default-on preserves the strict safety from C3.4. If owner
      // disables, downstream consumers will become orphaned — UI must surface
      // this risk separately (out of scope here).
      const cascadeBlockEnabled = await this.readBoolFlag(tx, 'reverse_block_cascaded', true);

      const pendingCn = await tx.expenseDocument.count({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { not: 'VOIDED' },
          deletedAt: null,
          creditNote: { originalDocumentId: id },
        },
      });
      if (cascadeBlockEnabled && pendingCn > 0) {
        throw new BadRequestException('มีใบลดหนี้ที่ยังไม่ถูกยกเลิก ไม่สามารถยกเลิกเอกสารต้นฉบับได้');
      }

      // C3.4 — Cascade check: also block void when an active SETTLEMENT
      // clears this doc. (Settlement-on-void of the SE itself separately
      // reverts cleared docs back to ACCRUAL — that's the SE-being-voided
      // path, not this one.) Gated by the same `reverse_block_cascaded` flag.
      const pendingSe = await tx.expenseDocument.count({
        where: {
          documentType: 'VENDOR_SETTLEMENT',
          status: { not: 'VOIDED' },
          deletedAt: null,
          settlement: { settlementLines: { some: { clearedDocumentId: id } } },
        },
      });
      if (cascadeBlockEnabled && pendingSe > 0) {
        throw new BadRequestException(
          'มีใบจ่ายเจ้าหนี้ (SE) ที่ยังไม่ถูกยกเลิกอ้างถึงเอกสารนี้อยู่ — ' +
            'กรุณายกเลิก SE ก่อน',
        );
      }

      this.transition.assertCanVoid({ from: doc.status });

      // Fix #C9 (Round 2 — moved from journal-auto.service.createAndPost):
      // Period-open guard at the module boundary. C3.1 — when caller passes
      // `reverseDate`, the reversal JE postedAt uses it (still V19-gated); else
      // the legacy behavior (today BKK noon).
      const reverseAt = dto.reverseDate
        ? bkkBusinessDate(new Date(dto.reverseDate))
        : bkkBusinessDate(new Date());
      const shopForVoidPeriod = await tx.companyInfo.findFirst({
        where: { companyCode: 'SHOP', deletedAt: null },
        select: { id: true },
      });
      if (!shopForVoidPeriod) {
        throw new NotFoundException(
          'CompanyInfo with companyCode=SHOP not found — seed accounting data first',
        );
      }
      await validatePeriodOpen(tx, reverseAt, shopForVoidPeriod.id);

      // Post reversal JE (flipped Dr/Cr) if doc had one. The original JE stays
      // intact; the reversal lives as a separate POSTED entry tagged via metadata.
      // Reversal postedAt is BKK noon "today" — keeps the entry inside the
      // intended Thai accounting day regardless of UTC server clock.
      let reverseJournalEntryId: string | null = null;
      if (doc.journalEntryId) {
        const original = await tx.journalEntry.findUniqueOrThrow({
          where: { id: doc.journalEntryId },
          include: { lines: true },
        });
        // W6 fix — fall back to SHOP company id when legacy JE rows lack
        // companyId (pre-A.1b migration). Without this, voiding an old EX
        // throws "companyId required" from journal-auto.service. SHOP is the
        // canonical home for expense-side flows per accounting.md.
        let companyId = original.companyId;
        if (!companyId) {
          const shop = await tx.companyInfo.findFirst({
            where: { companyCode: 'SHOP', deletedAt: null },
            select: { id: true },
          });
          if (!shop) {
            // W6 (Round 2) — replace bare Error with NestJS exception so the
            // response is a clean 404 instead of a 500 with stack trace. Same
            // wording shape as the post()/voidDocument() period-guard SHOP
            // fallback and the FINANCE fallback in resolveFinanceCompanyId.
            throw new NotFoundException(
              'CompanyInfo with companyCode=SHOP not found — seed accounting data first',
            );
          }
          companyId = shop.id;
        }
        const reverseEntry = await this.journal.createAndPost(
          {
            description: `กลับรายการ ${doc.number}`,
            reference: doc.id,
            metadata: {
              tag: 'EXPENSE_VOID_REVERSAL',
              documentId: doc.id,
              documentNumber: doc.number,
              documentType: doc.documentType,
              originalJournalEntryId: original.id,
              flow: `expense-${doc.documentType.toLowerCase()}-void`,
              // C3 — reason metadata embedded so JE-side audits can grep
              // by reasonCode without joining audit_logs.
              reverseReasonCode: dto.reasonCode ?? null,
              reverseReasonDetail: dto.reasonDetail ?? null,
            },
            postedAt: reverseAt,
            companyId,
            lines: original.lines.map((l) => ({
              accountCode: l.accountCode,
              dr: new Prisma.Decimal(l.credit.toString()),
              cr: new Prisma.Decimal(l.debit.toString()),
              description: l.description ? `[กลับรายการ] ${l.description}` : '[กลับรายการ]',
            })),
          },
          tx,
        );
        reverseJournalEntryId = reverseEntry.id;
      }

      // VENDOR_SETTLEMENT side-effect: revert each cleared EX back to ACCRUAL.
      // The SE was the only thing that flipped them to POSTED + paidAt; voiding
      // the SE must undo that, otherwise the EXs stay POSTED with no payment.
      // updateMany with deletedAt:null guard so a soft-deleted EX is not
      // resurrected — if it was already deleted, we simply skip + log.
      if (doc.documentType === 'VENDOR_SETTLEMENT' && doc.settlement) {
        for (const line of doc.settlement.settlementLines) {
          const result = await tx.expenseDocument.updateMany({
            where: { id: line.clearedDocumentId, deletedAt: null },
            data: { status: 'ACCRUAL', paidAt: null },
          });
          if (result.count === 0) {
            this.logger.warn(
              `Void SE ${doc.number}: cleared EX ${line.clearedDocumentId} was soft-deleted — skipped revert`,
            );
          }
        }
      }

      // Compare-and-swap on status — second concurrent caller (if it somehow
      // bypassed the advisory lock) sees count=0 and aborts. Belt-and-braces.
      const flip = await tx.expenseDocument.updateMany({
        where: { id, status: { not: 'VOIDED' } },
        data: { status: 'VOIDED' },
      });
      if (flip.count === 0) {
        throw new BadRequestException('เอกสารถูกยกเลิกไปแล้ว');
      }

      // C3.3 — Audit trail with reason + reverse JE pointer. Stuffed into
      // `newValue` JSON rather than adding columns (AuditLog has a Merkle hash
      // chain — adding columns would break the verification path on existing rows).
      await tx.auditLog.create({
        data: {
          action: 'EXPENSE_VOIDED',
          entity: 'expense_document',
          entityId: id,
          userId,
          oldValue: { status: doc.status, journalEntryId: doc.journalEntryId },
          newValue: {
            status: 'VOIDED',
            reverseJournalEntryId,
            reverseDate: reverseAt.toISOString(),
            reasonCode: dto.reasonCode ?? null,
            reasonDetail: dto.reasonDetail ?? null,
            documentNumber: doc.number,
            documentType: doc.documentType,
          },
        },
      });

      return tx.expenseDocument.findUniqueOrThrow({ where: { id } });
    });
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  async softDelete(id: string, _userId: string) {
    const existing = await this.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('ลบได้เฉพาะเอกสาร DRAFT — เอกสารที่ post ไปแล้ว ใช้ void แทน');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('เอกสารถูกลบไปแล้ว');
    }
    return this.prisma.expenseDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
