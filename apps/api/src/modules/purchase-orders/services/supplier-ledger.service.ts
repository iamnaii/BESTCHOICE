import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { SUPPLIER_DEPOSIT_ACCOUNT } from '../../journal/cpa-templates/shop-supplier-payment.template';
import { bangkokCalendarParts, bangkokDateString, bangkokMidnight, bangkokStartOfDay } from '../../../utils/date.util';
import { SUPPLIER_PAYABLE_ACCOUNTS } from './supplier-payment.util';

/**
 * เจ้าหนี้รายผู้จัดจำหน่ายจากสมุดบัญชีหน้าร้าน — บัญชีย่อยเจ้าหนี้ตามผู้ติดต่อ (คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 1 ·
 * คำตัดสินเจ้าของ ข้อ 2 "รวมเข้าก้อน 2"): อ่านบรรทัด S21-1101 / S21-1102 / S11-4201 ของรายการรับของ·จ่ายเงิน·กลับรายการ
 * แล้วจัดกลุ่มตาม `metadata.supplierId` (รายการรับของก่อน 2026-10-05 ไม่มี supplierId → หาจาก poId) —
 * ไม่เพิ่มรหัสบัญชีในผัง (รอคำตอบบัญชีข้อ 4 ของเอกสาร 05/10 ว่าต้องการรหัสย่อยจริงไหม)
 */
const LEDGER_TAGS = ['SHOP_GOODS_RECEIVING', 'SHOP_SUPPLIER_PAYMENT', 'SHOP_SUPPLIER_PAYMENT_REVERSAL'];
const OPEN_PO_STATUSES = ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'];
const DUE_SOON_DAYS = 7;
const ZERO = new Decimal(0);
const money = (v: Decimal) => v.toFixed(2);

type EntryMeta = { tag?: string; kind?: string; supplierId?: string; poId?: string; poNumber?: string; grNumber?: string; paymentId?: string };
type LedgerEntry = {
  id: string;
  entryNumber: string;
  entryDate: Date;
  description: string;
  meta: EntryMeta;
  supplierId: string | null;
  lines: { accountCode: string; debit: Decimal; credit: Decimal }[];
};

interface SupplierAgg {
  opening: Decimal;
  receipts: Decimal;
  payments: Decimal;
  deposits: Decimal;
  payableByAccount: Record<string, Decimal>;
}

export interface SupplierLedgerRow {
  supplier: { id: string; name: string; hasVat: boolean };
  opening: string;
  receipts: string;
  payments: string;
  closing: string;
  payableByAccount: Record<string, string>;
  depositsOutstanding: string;
  openPoCount: number;
  /** วันครบกำหนดที่ใกล้ที่สุดของใบที่ยังจ่ายไม่ครบ (ISO) · null = ไม่มี */
  nextDue: string | null;
  dueState: 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NONE';
}

export class SupplierLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyResolverService,
  ) {}

  async ledger(month?: string) {
    const { label, periodStart, periodEnd } = this.parseMonth(month);
    const entries = await this.loadEntries(periodEnd);
    const aggs = new Map<string, SupplierAgg>();
    for (const entry of entries) {
      if (!entry.supplierId) continue;
      const agg = aggs.get(entry.supplierId) ?? { opening: ZERO, receipts: ZERO, payments: ZERO, deposits: ZERO, payableByAccount: {} };
      const inPeriod = entry.entryDate >= periodStart;
      for (const line of entry.lines) {
        if (SUPPLIER_PAYABLE_ACCOUNTS.includes(line.accountCode)) {
          const net = line.credit.sub(line.debit);
          agg.payableByAccount[line.accountCode] = (agg.payableByAccount[line.accountCode] ?? ZERO).add(net);
          if (inPeriod) {
            agg.receipts = agg.receipts.add(line.credit);
            agg.payments = agg.payments.add(line.debit);
          } else {
            agg.opening = agg.opening.add(net);
          }
        } else if (line.accountCode === SUPPLIER_DEPOSIT_ACCOUNT) {
          agg.deposits = agg.deposits.add(line.debit).sub(line.credit);
        }
      }
      aggs.set(entry.supplierId, agg);
    }

    const supplierIds = [...aggs.keys()];
    const suppliers: { id: string; name: string; hasVat: boolean }[] = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, hasVat: true } })
      : [];
    const openPos: { supplierId: string; dueDate: Date | null }[] = supplierIds.length
      ? await this.prisma.purchaseOrder.findMany({
          where: { deletedAt: null, supplierId: { in: supplierIds }, status: { in: OPEN_PO_STATUSES as never }, paymentStatus: { not: 'FULLY_PAID' } },
          select: { supplierId: true, dueDate: true },
        })
      : [];
    const nameOf = new Map(suppliers.map((s) => [s.id, s]));
    const openBySupplier = new Map<string, { count: number; nextDue: Date | null }>();
    for (const po of openPos) {
      const cur = openBySupplier.get(po.supplierId) ?? { count: 0, nextDue: null };
      cur.count += 1;
      if (po.dueDate && (!cur.nextDue || po.dueDate < cur.nextDue)) cur.nextDue = po.dueDate;
      openBySupplier.set(po.supplierId, cur);
    }

    const today = bangkokStartOfDay(new Date());
    const soon = new Date(today.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
    const totals = { closing: ZERO, depositsOutstanding: ZERO, dueWithin7Days: ZERO, overdue: ZERO };
    const rows: SupplierLedgerRow[] = [];
    for (const [supplierId, agg] of aggs) {
      const closing = agg.opening.add(agg.receipts).sub(agg.payments);
      const open = openBySupplier.get(supplierId) ?? { count: 0, nextDue: null };
      const hasActivity = !closing.isZero() || !agg.receipts.isZero() || !agg.payments.isZero() || !agg.deposits.isZero();
      if (!hasActivity && open.count === 0) continue;
      const dueState: SupplierLedgerRow['dueState'] = !open.nextDue
        ? 'NONE'
        : open.nextDue < today
          ? 'OVERDUE'
          : open.nextDue <= soon
            ? 'DUE_SOON'
            : 'OK';
      if (closing.gt(ZERO)) {
        if (dueState === 'OVERDUE') totals.overdue = totals.overdue.add(closing);
        else if (dueState === 'DUE_SOON') totals.dueWithin7Days = totals.dueWithin7Days.add(closing);
      }
      totals.closing = totals.closing.add(closing);
      totals.depositsOutstanding = totals.depositsOutstanding.add(agg.deposits);
      const supplier = nameOf.get(supplierId);
      rows.push({
        supplier: { id: supplierId, name: supplier?.name ?? '(ไม่พบผู้จัดจำหน่าย)', hasVat: supplier?.hasVat ?? false },
        opening: money(agg.opening),
        receipts: money(agg.receipts),
        payments: money(agg.payments),
        closing: money(closing),
        payableByAccount: Object.fromEntries(
          Object.entries(agg.payableByAccount)
            .filter(([, v]) => !v.isZero())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, money(v)]),
        ),
        depositsOutstanding: money(agg.deposits),
        openPoCount: open.count,
        nextDue: open.nextDue ? open.nextDue.toISOString() : null,
        dueState,
      });
    }
    rows.sort((a, b) => Number(b.closing) - Number(a.closing) || a.supplier.name.localeCompare(b.supplier.name, 'th'));
    return {
      month: label,
      periodStart,
      periodEnd,
      totals: {
        closing: money(totals.closing),
        depositsOutstanding: money(totals.depositsOutstanding),
        dueWithin7Days: money(totals.dueWithin7Days),
        overdue: money(totals.overdue),
        supplierCount: rows.length,
        openPoCount: rows.reduce((sum, r) => sum + r.openPoCount, 0),
      },
      suppliers: rows,
    };
  }

  /** รายการเคลื่อนไหวของผู้จัดจำหน่ายรายเดียวในเดือน — ไล่ยอดเจ้าหนี้คงเหลือจากยอดยกมา */
  async movements(supplierId: string, month?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, hasVat: true } });
    if (!supplier) throw new NotFoundException('ไม่พบผู้จัดจำหน่าย');
    const { label, periodStart, periodEnd } = this.parseMonth(month);
    const entries = (await this.loadEntries(periodEnd)).filter((e) => e.supplierId === supplierId);
    let running = ZERO;
    for (const entry of entries) {
      if (entry.entryDate >= periodStart) break;
      for (const line of entry.lines) {
        if (SUPPLIER_PAYABLE_ACCOUNTS.includes(line.accountCode)) running = running.add(line.credit).sub(line.debit);
      }
    }
    const opening = running;
    const rows = entries
      .filter((e) => e.entryDate >= periodStart)
      .map((entry) => {
        let increase = ZERO;
        let decrease = ZERO;
        let deposit = ZERO;
        for (const line of entry.lines) {
          if (SUPPLIER_PAYABLE_ACCOUNTS.includes(line.accountCode)) {
            increase = increase.add(line.credit);
            decrease = decrease.add(line.debit);
          } else if (line.accountCode === SUPPLIER_DEPOSIT_ACCOUNT) {
            deposit = deposit.add(line.debit).sub(line.credit);
          }
        }
        running = running.add(increase).sub(decrease);
        const kind =
          entry.meta.tag === 'SHOP_GOODS_RECEIVING'
            ? 'RECEIVING'
            : entry.meta.tag === 'SHOP_SUPPLIER_PAYMENT_REVERSAL'
              ? `${entry.meta.kind ?? ''}_REVERSAL`.replace(/^_/, '')
              : (entry.meta.kind ?? 'UNKNOWN');
        return {
          journalEntryId: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          description: entry.description,
          kind,
          poNumber: entry.meta.poNumber ?? null,
          grNumber: entry.meta.grNumber ?? null,
          paymentId: entry.meta.paymentId ?? null,
          payableIncrease: money(increase),
          payableDecrease: money(decrease),
          depositChange: money(deposit),
          running: money(running),
        };
      });
    return { supplier, month: label, opening: money(opening), closing: money(running), rows };
  }

  private parseMonth(month?: string) {
    let year: number;
    let monthIndex: number;
    if (month === undefined || month === '') {
      const now = bangkokCalendarParts(new Date());
      year = now.year;
      monthIndex = now.month;
    } else {
      const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
      if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new BadRequestException('เดือนไม่ถูกต้อง (YYYY-MM)');
      year = Number(match[1]);
      monthIndex = Number(match[2]) - 1;
    }
    return {
      label: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      periodStart: bangkokMidnight(year, monthIndex, 1),
      periodEnd: bangkokMidnight(year, monthIndex + 1, 1),
    };
  }

  /** รายการสมุดหน้าร้านของเมนูนี้ก่อนสิ้นงวด พร้อม supplierId (จาก metadata หรือย้อนจาก poId) เรียงวันที่ */
  private async loadEntries(periodEnd: Date): Promise<LedgerEntry[]> {
    const shopCompanyId = await this.companies.getShopCompanyId(this.prisma as never);
    const raw = await this.prisma.journalEntry.findMany({
      where: {
        companyId: shopCompanyId,
        deletedAt: null,
        status: 'POSTED',
        entryDate: { lt: periodEnd },
        OR: LEDGER_TAGS.map((tag) => ({ metadata: { path: ['tag'], equals: tag } as never })),
      },
      select: {
        id: true,
        entryNumber: true,
        entryDate: true,
        description: true,
        metadata: true,
        lines: {
          where: { deletedAt: null, accountCode: { in: [...SUPPLIER_PAYABLE_ACCOUNTS, SUPPLIER_DEPOSIT_ACCOUNT] } },
          select: { accountCode: true, debit: true, credit: true },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
    });
    const entries: LedgerEntry[] = raw.map((e) => {
      const meta = (e.metadata ?? {}) as EntryMeta;
      return {
        id: e.id,
        entryNumber: e.entryNumber,
        entryDate: e.entryDate,
        description: e.description,
        meta,
        supplierId: meta.supplierId ?? null,
        lines: e.lines.map((l) => ({ accountCode: l.accountCode, debit: new Decimal(l.debit.toString()), credit: new Decimal(l.credit.toString()) })),
      };
    });
    // วันเดียวกันเรียงตามลำดับที่สร้าง (เลขที่รายการ) — รายการจ่ายลงเที่ยงคืนของวันโอน ส่วนรับของลงเวลาจริง ถ้าเรียงเวลาดิบ
    // รายการจ่ายของวันนั้นจะโผล่ก่อนรับของ ทั้งที่บันทึกทีหลัง
    entries.sort((a, b) => bangkokDateString(a.entryDate).localeCompare(bangkokDateString(b.entryDate)) || a.entryNumber.localeCompare(b.entryNumber));
    const missingPoIds = [...new Set(entries.filter((e) => !e.supplierId && e.meta.poId).map((e) => e.meta.poId as string))];
    if (missingPoIds.length) {
      const pos = await this.prisma.purchaseOrder.findMany({ where: { id: { in: missingPoIds } }, select: { id: true, supplierId: true } });
      const bySupplier = new Map(pos.map((p) => [p.id, p.supplierId]));
      for (const entry of entries) {
        if (!entry.supplierId && entry.meta.poId) entry.supplierId = bySupplier.get(entry.meta.poId) ?? null;
      }
    }
    return entries;
  }
}
