import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ShopTenderKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { bangkokDateRange } from '../../utils/date.util';

export interface TenderViewer {
  id: string;
  role: string;
  branchId?: string | null;
}

/** ALL = ทุกสาขา (เลือกสาขาได้) · BRANCH = สาขาตัวเอง · OWN = เฉพาะรายการที่ตัวเองรับ/จ่าย */
export type TenderScope = 'ALL' | 'BRANCH' | 'OWN';

const KIND_ORDER: ShopTenderKind[] = [
  'CONTRACT_DOWN', 'CASH_SALE', 'EXTERNAL_FINANCE_DOWN', 'BOOKING_DEPOSIT',
  'TRADE_IN_PAYOUT', 'SALE_VOID_REFUND', 'CONTRACT_DOWN_REFUND', 'BOOKING_DEPOSIT_REFUND',
];

const ROW_INCLUDE = {
  actor: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  sale: { select: { saleNumber: true, customer: { select: { name: true } } } },
  contract: { select: { contractNumber: true, customer: { select: { name: true } } } },
  booking: { select: { bookingNumber: true, customer: { select: { name: true } } } },
  tradeIn: { select: { voucherNumber: true, sellerName: true, customer: { select: { name: true } } } },
} satisfies Prisma.ShopTenderInclude;

type TenderRow = Prisma.ShopTenderGetPayload<{ include: typeof ROW_INCLUDE }>;

/** วันทำการ = เที่ยงคืนถึงเที่ยงคืนตามเวลาไทย ไม่ใช่เวลาของเครื่องเซิร์ฟเวอร์ (Cloud Run เป็น UTC) — ใช้ตัวช่วยกลางของระบบ */
export function bkkDayRange(date: string): { start: Date; end: Date } {
  const { gte, lt } = bangkokDateRange(date, date);
  return { start: gte!, end: lt! };
}

const refKey = (reference: string) => reference.trim().toLowerCase();
const money = (d: Prisma.Decimal) => d.toFixed(2);
const ZERO = new Prisma.Decimal(0);

function docOf(row: { saleId: string | null; contractId: string | null; bookingId: string | null; tradeInId?: string | null;
  sale?: { saleNumber: string } | null; contract?: { contractNumber: string } | null;
  booking?: { bookingNumber: string | null } | null; tradeIn?: { voucherNumber: string | null } | null }) {
  if (row.saleId) return { docType: 'sale' as const, docId: row.saleId, docNumber: row.sale?.saleNumber ?? row.saleId };
  if (row.contractId) return { docType: 'contract' as const, docId: row.contractId, docNumber: row.contract?.contractNumber ?? row.contractId };
  if (row.bookingId) return { docType: 'booking' as const, docId: row.bookingId, docNumber: row.booking?.bookingNumber ?? row.bookingId };
  return { docType: 'tradeIn' as const, docId: row.tradeInId ?? '', docNumber: row.tradeIn?.voucherNumber ?? row.tradeInId ?? '' };
}

/**
 * หน้าสรุปเงินหน้าร้านรายวัน (สเปค 2026-09-20-shop-tenders-daily-cash) — อ่านจากสมุด `shop_tenders` ตารางเดียว:
 * หนึ่งแถว = เงินหนึ่งก้อนที่รับ/จ่ายจริงด้วยวิธีเดียว ผู้รับ/ผู้จ่าย = ผู้ใช้ที่กดทำรายการ.
 * ไม่รวมค่างวดที่ลูกค้าจ่ายให้ FINANCE (มีสรุปรายวันของตัวเองที่ GET /payments/daily-summary).
 */
@Injectable()
export class ShopTendersReportService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveScope(viewer: TenderViewer, requestedBranchId?: string): { scope: TenderScope; where: Prisma.ShopTenderWhereInput; branchId: string | null } {
    if (hasCrossBranchAccess(viewer)) {
      return { scope: 'ALL', where: requestedBranchId ? { branchId: requestedBranchId } : {}, branchId: requestedBranchId ?? null };
    }
    if (viewer.role === 'BRANCH_MANAGER') {
      // fail-closed: ผู้จัดการสาขาที่ไม่มีสาขาติดตัว หรือขอดูสาขาอื่น = ปฏิเสธ (BranchGuard ไม่ครอบ service นี้)
      if (!viewer.branchId || (requestedBranchId && requestedBranchId !== viewer.branchId)) {
        throw new ForbiddenException('ผู้จัดการสาขาดูสรุปเงินได้เฉพาะสาขาของตัวเอง');
      }
      return { scope: 'BRANCH', where: { branchId: viewer.branchId }, branchId: viewer.branchId };
    }
    if (viewer.role === 'SALES') {
      // พนักงานขายเห็นเฉพาะเงินที่ตัวเองรับ/จ่าย — branchId ที่ส่งมาถูกละเลย
      return { scope: 'OWN', where: { actorId: viewer.id }, branchId: null };
    }
    throw new ForbiddenException('ไม่มีสิทธิ์ดูสรุปเงินหน้าร้าน');
  }

  async getDailySummary(query: { date: string; branchId?: string }, viewer: TenderViewer) {
    const { start, end } = bkkDayRange(query.date);
    const { scope, where, branchId } = this.resolveScope(viewer, query.branchId);

    const found: TenderRow[] = await this.prisma.shopTender.findMany({
      where: { ...where, occurredAt: { gte: start, lt: end } },
      include: ROW_INCLUDE,
      orderBy: [{ occurredAt: 'asc' }, { seq: 'asc' }],
    });
    const docs = new Map(found.map((r) => [r.id, docOf(r)]));
    const tenders = [...found].sort((a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime()
      || docs.get(a.id)!.docId.localeCompare(docs.get(b.id)!.docId)
      || a.seq - b.seq);

    // ── เลขอ้างอิงซ้ำ: เงินเข้าที่ไม่ใช่เงินสด เลขเดียวกัน (ไม่สนตัวพิมพ์) คนละเอกสาร — ไม่จำกัดวัน (สลิปเก่าเอามาใช้ซ้ำ)
    const refDocs = new Map<string, Map<string, string>>();
    const noteRef = (reference: string | null, doc: { docType: string; docId: string; docNumber: string }) => {
      if (!reference) return;
      const key = refKey(reference);
      if (!refDocs.has(key)) refDocs.set(key, new Map());
      refDocs.get(key)!.set(`${doc.docType}:${doc.docId}`, doc.docNumber);
    };
    const transfersIn = tenders.filter((r) => r.direction === 'IN' && r.method !== 'CASH' && r.reference);
    transfersIn.forEach((r) => noteRef(r.reference, docs.get(r.id)!));
    if (transfersIn.length) {
      const references = [...new Set(transfersIn.map((r) => r.reference!.trim()))];
      const others = await this.prisma.shopTender.findMany({
        where: {
          direction: 'IN', method: { not: 'CASH' }, id: { notIn: tenders.map((r) => r.id) },
          OR: references.map((reference) => ({ reference: { equals: reference, mode: 'insensitive' as const } })),
        },
        select: {
          reference: true, saleId: true, contractId: true, bookingId: true,
          sale: { select: { saleNumber: true } }, contract: { select: { contractNumber: true } },
          booking: { select: { bookingNumber: true } },
        },
      });
      others.forEach((o) => noteRef(o.reference, docOf(o)));
    }
    const duplicateKeys = new Set([...refDocs].filter(([, d]) => d.size > 1).map(([key]) => key));

    // ── ยอดรวม · แยกตามพนักงาน · แยกตามประเภท
    const sum = { cashIn: ZERO, transferIn: ZERO, qrIn: ZERO, cashOut: ZERO, nonCashOut: ZERO };
    let inCount = 0;
    let outCount = 0;
    const staff = new Map<string, { actorId: string; name: string; cashIn: Prisma.Decimal; transferIn: Prisma.Decimal; qrIn: Prisma.Decimal;
      cashOut: Prisma.Decimal; nonCashOut: Prisma.Decimal; count: number }>();
    const kinds = new Map<ShopTenderKind, { direction: string; cash: Prisma.Decimal; transfer: Prisma.Decimal; qr: Prisma.Decimal; count: number }>();

    for (const r of tenders) {
      const s = staff.get(r.actorId) ?? { actorId: r.actorId, name: r.actor.name, cashIn: ZERO, transferIn: ZERO, qrIn: ZERO, cashOut: ZERO, nonCashOut: ZERO, count: 0 };
      const k = kinds.get(r.kind) ?? { direction: r.direction, cash: ZERO, transfer: ZERO, qr: ZERO, count: 0 };
      const bucket = r.method === 'CASH' ? 'cash' : r.method === 'QR_EWALLET' ? 'qr' : 'transfer';
      k[bucket] = k[bucket].plus(r.amount);
      if (r.direction === 'IN') {
        inCount += 1;
        const field = bucket === 'cash' ? 'cashIn' : bucket === 'qr' ? 'qrIn' : 'transferIn';
        sum[field] = sum[field].plus(r.amount);
        s[field] = s[field].plus(r.amount);
      } else {
        outCount += 1;
        const field = bucket === 'cash' ? 'cashOut' : 'nonCashOut';
        sum[field] = sum[field].plus(r.amount);
        s[field] = s[field].plus(r.amount);
      }
      s.count += 1;
      k.count += 1;
      staff.set(r.actorId, s);
      kinds.set(r.kind, k);
    }

    const branches = scope === 'ALL'
      ? await this.prisma.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];

    return {
      date: query.date,
      scope,
      branchId,
      branches,
      totals: {
        cashIn: money(sum.cashIn), transferIn: money(sum.transferIn), qrIn: money(sum.qrIn),
        totalIn: money(sum.cashIn.plus(sum.transferIn).plus(sum.qrIn)),
        cashOut: money(sum.cashOut), nonCashOut: money(sum.nonCashOut), totalOut: money(sum.cashOut.plus(sum.nonCashOut)),
        expectedCashInDrawer: money(sum.cashIn.minus(sum.cashOut)),
        inCount, outCount,
      },
      byStaff: [...staff.values()].map((s) => ({
        actorId: s.actorId, name: s.name, cashIn: money(s.cashIn), transferIn: money(s.transferIn), qrIn: money(s.qrIn),
        cashOut: money(s.cashOut), nonCashOut: money(s.nonCashOut), netCash: money(s.cashIn.minus(s.cashOut)), count: s.count,
      })),
      byKind: KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => {
        const k = kinds.get(kind)!;
        return { kind, direction: k.direction, cash: money(k.cash), transfer: money(k.transfer), qr: money(k.qr),
          total: money(k.cash.plus(k.transfer).plus(k.qr)), count: k.count };
      }),
      rows: tenders.map((r) => {
        const doc = docs.get(r.id)!;
        const party = r.sale?.customer ?? r.contract?.customer ?? r.booking?.customer ?? r.tradeIn?.customer ?? null;
        return {
          id: r.id, occurredAt: r.occurredAt.toISOString(), kind: r.kind, direction: r.direction, ...doc,
          customerName: party?.name ?? r.tradeIn?.sellerName ?? null,
          method: r.method, reference: r.reference, amount: money(r.amount), seq: r.seq, seqTotal: r.seqTotal,
          actorId: r.actorId, actorName: r.actor.name, branchId: r.branchId, branchName: r.branch.name,
          duplicateReference: r.direction === 'IN' && !!r.reference && duplicateKeys.has(refKey(r.reference)),
        };
      }),
      duplicateReferences: [...duplicateKeys].map((key) => ({
        reference: transfersIn.find((r) => refKey(r.reference!) === key)!.reference!.trim(),
        documents: [...refDocs.get(key)!.values()],
      })),
    };
  }
}
