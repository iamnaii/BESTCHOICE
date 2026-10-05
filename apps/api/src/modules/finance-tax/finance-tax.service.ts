import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTALLMENT_INPUT_VAT_FLOW } from '../journal/cpa-templates/installment-input-vat.template';
import {
  computePp30OutputVat,
  isVatSettlementEntry,
  PP30_VAT_SETTLEMENT_ACCOUNT,
  pp30MonthRange,
  resolvePp30CompanyId,
  toPp30OutputVatJson,
} from '../tax/pp30-output-vat';

// VAT accounts used across tasks
// 21-2101 + 21-2103 = แถวภาษีขายของตาราง `lines` (แสดงผลเท่านั้น) — ยอดมาจาก computePp30OutputVat (21-2103 ยังไม่รวม)
const VAT_OUTPUT_ACCOUNTS = ['21-2101', '21-2103'];
const VAT_DEFERRED_ACCOUNTS = ['21-2102'];
const VAT_INPUT_ACCOUNTS = ['11-4101'];
const VAT_INPUT_BEHALF_ACCOUNTS = ['11-2104'];

// All VAT-related accounts (for auto-journal history — includes 11-2105 accrual VAT)
const ALL_VAT_ACCOUNTS = ['21-2101', '21-2102', '11-4101', '11-2104', '11-2105'];

// WHT accounts
// S21-3101 = SHOP-scope payroll (คำสั่งเจ้าของ 2026-08-06) — นิติบุคคลเดียวกัน
// ภ.ง.ด.1 ยื่นรวม จึงรวมทั้งสองบัญชีในรายงานเดียว.
const WHT_PND1_ACCOUNTS = ['21-3101', 'S21-3101'];
const WHT_PND3_ACCOUNTS = ['21-3102'];
const WHT_PND53_ACCOUNTS = ['21-3103'];
const ALL_WHT_ACCOUNTS = [...WHT_PND1_ACCOUNTS, ...WHT_PND3_ACCOUNTS, ...WHT_PND53_ACCOUNTS];

export interface PeriodBounds {
  year: number;
  month: number;
  start: Date;
  end: Date;
}

function buildPeriod(year: number, month: number): PeriodBounds {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0); // exclusive upper bound
  return { year, month, start, end };
}

export interface VatLine {
  accountCode: string;
  documentNumber: string;
  postedAt: Date | null;
  description: string | null;
  debit: number;
  credit: number;
}

export interface WhtLine {
  documentNumber: string;
  postedAt: Date | null;
  description: string | null;
  amount: number; // credit - debit (positive = payable accrual, negative = settlement)
}

export interface VatAutoJournalVatLine {
  accountCode: string;
  debit: number;
  credit: number;
}

@Injectable()
export class FinanceTaxService {
  constructor(private prisma: PrismaService) {}

  /**
   * Task 2 — VAT monthly aggregation (หน้า /finance/vat เมนู "VAT (ภ.พ.30)")
   *
   * ภาษีขาย (`vatOutput` + `outputVat`) มาจากตัวคำนวณเดียวของ ภ.พ.30 `computePp30OutputVat` (21-2101 สุทธิ · ภาษีขาย
   * 60 วัน 21-2103 อยู่ใน `outputVat.mandatory60Day*` เป็นข้อมูลประกอบ ยังไม่รวม — `PP30_INCLUDES_MANDATORY_60DAY`)
   * — ตัวเดียวกับ `TaxPreviewService.previewPP30`. หน้าเมนูไม่ส่ง `companyId` ⇒ ภาษีขายเป็นของบริษัท FINANCE.
   * ภาษีซื้อ / ภาษีขายรอเรียกเก็บ / ตารางรายการ: บัญชี สถานะ และเครื่องหมายเดิม ไม่กรองบริษัทเมื่อไม่ส่ง `companyId` (กติกาเดิม)
   * — เปลี่ยนเฉพาะการบวกเป็น Decimal และขอบเดือนเป็นปฏิทินไทย (เท่าเดิมบน prod ที่รัน TZ=Asia/Bangkok).
   *
   * รายการปิด/ชำระภาษีขาย (มีบรรทัดที่ยังไม่ถูกลบบนบัญชี 21-3201 — ตรวจด้วย `isVatSettlementEntry` ตัวเดียวกับ
   * ตัวคำนวณ) อยู่นอกยอด ภ.พ.30 ของเดือนทั้งใบ ไม่ใช่แค่ 21-2101: ภาษีซื้อ (`vatInput`) ต้องข้ามบรรทัด 11-4101
   * ของรายการปิดด้วย (ไม่งั้นเครดิตภาษีซื้อที่ถูก "ใช้" ตอนปิดยอดจะไปหักล้างภาษีซื้อใหม่ของเดือนเดียวกัน) และ
   * ตารางรายการ (`lines`/`lineCount`) ไม่แสดงบรรทัดใดของรายการปิดเลย (Task 3 fix round 1, controller F1,
   * 2026-09-30 — narrow relaxation ของ V4 ที่กระทบเฉพาะรายการที่แตะ 21-3201 เท่านั้น; `getInputVatLineItems`
   * ของ `TaxPreviewService` ไม่ถูกแตะ).
   * Maps entryNumber → documentNumber per SP1 convention.
   */
  async getVatMonthly(year: number, month: number, companyId?: string) {
    // ตรวจปี/เดือนก่อน query ใด ๆ (ค่าผิดรูป = 400 "ปี/เดือนไม่ถูกต้อง")
    const range = pp30MonthRange(year, month);
    const period: PeriodBounds = { year, month, start: range.gte, end: range.lt };

    const output = await computePp30OutputVat(this.prisma, {
      companyId: await resolvePp30CompanyId(this.prisma, companyId),
      year,
      month,
    });

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: range.gte,
        lt: range.lt,
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const allVatAccountCodes = [
      ...VAT_OUTPUT_ACCOUNTS,
      ...VAT_DEFERRED_ACCOUNTS,
      ...VAT_INPUT_ACCOUNTS,
      ...VAT_INPUT_BEHALF_ACCOUNTS,
    ];

    const rawLines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        accountCode: { in: allVatAccountCodes },
        journalEntry: entryWhere,
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            metadata: true,
            entryNumber: true,
            postedAt: true,
            description: true,
            // Task 3 fix round 1 (F1): ตรวจว่ารายการนี้เป็นรายการปิด/ชำระภาษีขายหรือไม่ — take 1 พอ (เหมือนตัวคำนวณ)
            lines: {
              where: { accountCode: PP30_VAT_SETTLEMENT_ACCOUNT, deletedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { accountCode: 'asc' },
      ],
    });

    // รายการปิด/ชำระภาษีขายอยู่นอกยอด ภ.พ.30 ของเดือนทั้งใบ — ทั้งภาษีซื้อและตารางรายการ (fix round 1, F1)
    const lines = rawLines.filter((l) => !isVatSettlementEntry(l.journalEntry));

    // ก้อน 5 — แยกภาษีซื้อสองก้อน: เครื่องขายผ่อน (flow finance-input-vat-installment) vs ที่เหลือ (ค่าใช้จ่าย/สินทรัพย์).
    // ใบกระจกจากการยกเลิกสัญญามี tag REVERSAL + reversesEntryId → จัดเข้าก้อนเดียวกับใบต้นทาง (อ่าน metadata ของต้นทาง)
    type RawLine = (typeof lines)[number];
    const meta = (l: RawLine) => ((l.journalEntry.metadata ?? {}) as Record<string, unknown>);
    const isInputLine = (l: RawLine) => VAT_INPUT_ACCOUNTS.includes(l.accountCode);
    // ใบกระจกชี้ต้นทางด้วย `reversesEntryId` (sweep ยกเลิกสัญญา / ยกเลิกเปลี่ยนเครื่อง) หรือ `originalEntryId` (เปลี่ยนเครื่องตำหนิ A.5a)
    const mirrorOf = (l: RawLine): string | null => {
      const m = meta(l);
      if (m.tag !== 'REVERSAL') return null;
      const id = m.reversesEntryId ?? m.originalEntryId;
      return typeof id === 'string' ? id : null;
    };
    const reversesIds = [...new Set(lines.filter(isInputLine).map(mirrorOf).filter((v): v is string => !!v))];
    const originals = reversesIds.length
      ? await this.prisma.journalEntry.findMany({ where: { id: { in: reversesIds } }, select: { id: true, entryNumber: true, metadata: true } })
      : [];
    const installmentOriginals = new Map(
      originals
        .filter((o) => ((o.metadata ?? {}) as Record<string, unknown>).flow === INSTALLMENT_INPUT_VAT_FLOW)
        .map((o) => [o.id, (o.metadata ?? {}) as Record<string, unknown>] as const),
    );
    const isInstallmentLine = (l: RawLine) => {
      if (!isInputLine(l)) return false;
      if (meta(l).flow === INSTALLMENT_INPUT_VAT_FLOW) return true;
      const src = mirrorOf(l);
      return !!src && installmentOriginals.has(src);
    };

    // ภาษีขายรอเรียกเก็บ (21-2102) และภาษีซื้อ (11-4101) — Decimal (เดิม Number + Math.round)
    let vatDeferred = new Prisma.Decimal(0); // 21-2102: credit - debit (liability account)
    let vatInput = new Prisma.Decimal(0); // 11-4101: debit - credit (asset account)
    let vatInputExpense = new Prisma.Decimal(0); // ก้อน 5 — 11-4101 ที่ไม่ใช่เครื่องขายผ่อน
    let vatInputInstallment = new Prisma.Decimal(0); // ก้อน 5 — flow finance-input-vat-installment + กระจก

    const responseLines: VatLine[] = lines.map((l) => {
      const debit = new Prisma.Decimal(l.debit ?? 0);
      const credit = new Prisma.Decimal(l.credit ?? 0);

      if (VAT_DEFERRED_ACCOUNTS.includes(l.accountCode)) {
        vatDeferred = vatDeferred.plus(credit).minus(debit);
      } else if (VAT_INPUT_ACCOUNTS.includes(l.accountCode)) {
        const net = debit.minus(credit); // asset increases on debit
        vatInput = vatInput.plus(net);
        if (isInstallmentLine(l)) vatInputInstallment = vatInputInstallment.plus(net);
        else vatInputExpense = vatInputExpense.plus(net);
      }
      // 21-2101 / 21-2103 แสดงในตารางเท่านั้น — ยอดภาษีขายมาจาก `output` (ตัวคำนวณเดียว)
      // ตารางแสดงวันที่ post (`postedAt`) ขณะที่เดือนนับจาก `entryDate` (ของเดิม · เท่ากันสำหรับรายการที่ระบบลง)
      // VAT_INPUT_BEHALF_ACCOUNTS (11-2104) tracked in lines but not in netVat
      // per CLAUDE.md: 11-2104 is ม.83/6 cases, not claimable on ภ.พ.30

      return {
        accountCode: l.accountCode,
        documentNumber: l.journalEntry.entryNumber, // entryNumber → documentNumber
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        debit: debit.toNumber(), // ค่าแสดงผลรายบรรทัด — ไม่ใช้บวกยอด
        credit: credit.toNumber(),
      };
    });

    // ก้อน 5 — ตารางรายสัญญา (ใบเคลม + กระจก) · metadata ที่แสดง = ของใบต้นทางเสมอ
    const installmentLines = lines.filter(isInstallmentLine);
    const sourceMeta = (l: RawLine): Record<string, unknown> => {
      const src = mirrorOf(l);
      return src ? (installmentOriginals.get(src) ?? {}) : meta(l);
    };
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const missingNumberIds = [
      ...new Set(
        installmentLines
          .filter((l) => !str(sourceMeta(l).contractNumber) && str(sourceMeta(l).contractId))
          .map((l) => sourceMeta(l).contractId as string),
      ),
    ];
    const contractNumbers = new Map(
      (missingNumberIds.length
        ? await this.prisma.contract.findMany({ where: { id: { in: missingNumberIds } }, select: { id: true, contractNumber: true } })
        : []
      ).map((c) => [c.id, c.contractNumber] as const),
    );
    const installmentInputVatLines = installmentLines
      .map((l) => {
        const src = sourceMeta(l);
        const own = meta(l);
        const reversal = own.tag === 'REVERSAL';
        const contractId = str(src.contractId);
        return {
          postedAt: l.journalEntry.postedAt,
          entryNumber: l.journalEntry.entryNumber,
          contractId,
          contractNumber: str(src.contractNumber) ?? (contractId ? contractNumbers.get(contractId) ?? null : null),
          productId: str(src.productId),
          grNumber: str(src.grNumber),
          taxInvoiceNumber: str(src.taxInvoiceNumber),
          taxInvoiceDate: str(src.taxInvoiceDate),
          invoiceAgeMonths: typeof src.invoiceAgeMonths === 'number' ? src.invoiceAgeMonths : null,
          amount: new Prisma.Decimal(l.debit ?? 0).minus(new Prisma.Decimal(l.credit ?? 0)).toFixed(2),
          reversal,
          reversed: !reversal && own.reversed === true,
        };
      })
      .sort((a, b) => (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0));

    // netVat = vatOutput - vatInput (standard ภ.พ.30 calculation)
    const netVat = output.totalOutputVat.minus(vatInput);

    return {
      period,
      vatOutput: output.totalOutputVat.toFixed(2),
      vatDeferred: vatDeferred.toFixed(2),
      vatInput: vatInput.toFixed(2),
      // ก้อน 5 — vatInput = vatInputExpense + vatInputInstallment
      vatInputExpense: vatInputExpense.toFixed(2),
      vatInputInstallment: vatInputInstallment.toFixed(2),
      installmentInputVatLines,
      netVat: netVat.toFixed(2),
      outputVat: toPp30OutputVatJson(output),
      lineCount: lines.length,
      lines: responseLines,
    };
  }

  /**
   * Task 3 — WHT monthly aggregation
   * Queries JournalLines for WHT accounts within the given month.
   * Groups by form type: PND1 (21-3101), PND3 (21-3102), PND53 (21-3103).
   */
  async getWhtMonthly(year: number, month: number, companyId?: string) {
    const period = buildPeriod(year, month);

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: period.start,
        lt: period.end,
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        accountCode: { in: ALL_WHT_ACCOUNTS },
        journalEntry: entryWhere,
      },
      include: {
        journalEntry: {
          select: {
            entryNumber: true,
            postedAt: true,
            description: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { accountCode: 'asc' },
      ],
    });

    const pnd1Lines: WhtLine[] = [];
    const pnd3Lines: WhtLine[] = [];
    const pnd53Lines: WhtLine[] = [];

    for (const l of lines) {
      const debit = Number(l.debit ?? 0);
      const credit = Number(l.credit ?? 0);
      const amount = credit - debit; // positive = payable accrual, negative = settlement

      const whtLine: WhtLine = {
        documentNumber: l.journalEntry.entryNumber,
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        amount: Math.round(amount * 100) / 100,
      };

      if (WHT_PND1_ACCOUNTS.includes(l.accountCode)) {
        pnd1Lines.push(whtLine);
      } else if (WHT_PND3_ACCOUNTS.includes(l.accountCode)) {
        pnd3Lines.push(whtLine);
      } else if (WHT_PND53_ACCOUNTS.includes(l.accountCode)) {
        pnd53Lines.push(whtLine);
      }
    }

    const pnd1Total = pnd1Lines.reduce((s, l) => s + l.amount, 0);
    const pnd3Total = pnd3Lines.reduce((s, l) => s + l.amount, 0);
    const pnd53Total = pnd53Lines.reduce((s, l) => s + l.amount, 0);
    const grandTotal = pnd1Total + pnd3Total + pnd53Total;

    return {
      period,
      PND1: {
        lines: pnd1Lines,
        total: Math.round(pnd1Total * 100) / 100,
      },
      PND3: {
        lines: pnd3Lines,
        total: Math.round(pnd3Total * 100) / 100,
      },
      PND53: {
        lines: pnd53Lines,
        total: Math.round(pnd53Total * 100) / 100,
      },
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }

  /**
   * Task 4 — VAT Auto Journal history
   * Returns all JournalEntries where any line touches VAT accounts.
   * Uses nested include.where to filter only VAT lines per entry.
   */
  async getVatAutoJournalHistory(year: number, month: number, companyId?: string) {
    const period = buildPeriod(year, month);

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: period.start,
        lt: period.end,
      },
      lines: {
        some: {
          accountCode: { in: ALL_VAT_ACCOUNTS },
          deletedAt: null,
        },
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: entryWhere,
      include: {
        lines: {
          where: {
            accountCode: { in: ALL_VAT_ACCOUNTS },
            deletedAt: null,
          },
        },
      },
      orderBy: { entryDate: 'asc' },
    });

    const responseEntries = entries.map((entry) => {
      const vatLines: VatAutoJournalVatLine[] = entry.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: Number(l.debit ?? 0),
        credit: Number(l.credit ?? 0),
      }));

      return {
        id: entry.id,
        documentNumber: entry.entryNumber, // entryNumber → documentNumber
        postedAt: entry.postedAt,
        sourceType: entry.referenceType, // referenceType → sourceType
        description: entry.description,
        vatLines,
      };
    });

    return {
      period,
      entries: responseEntries,
    };
  }
}
