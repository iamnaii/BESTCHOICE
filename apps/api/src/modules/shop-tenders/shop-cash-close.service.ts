import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShopCashCloseStatus, ShopCashDestination } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { bangkokDateRange, bangkokDateString } from '../../utils/date.util';
import { bkkDayRange } from './shop-tenders-report.service';

export interface CashCloseActor {
  id: string;
  role: string;
  branchId?: string | null;
}

/**
 * นับเงินปิดยอดลิ้นชักของสาขา — คำตัดสินเจ้าของ 2026-09-20 (mockup กระดาน 7–9, เคาะตามข้อเสนอทั้งหมด):
 *  - หนึ่งสาขา = หนึ่งลิ้นชัก · ปิดยอดแล้วส่งเงินทั้งหมด เหลือ "เงินทอนตั้งต้น" คงที่ (`Branch.shopCashFloat`)
 *  - ต้องมีในลิ้นชัก = เงินทอนตั้งต้น + รับเงินสด − จ่ายเงินสดออก นับตั้งแต่ปิดยอดครั้งก่อนถึงตอนนับ (อ่านจาก `shop_tenders`)
 *  - ผู้นับ = พนักงานขาย/ผจก.สาขาของสาขานั้น (คนที่ล็อกอิน) · ผู้ยืนยัน = เจ้าของ/ผจก.การเงิน/ผจก.สาขา และต้องไม่ใช่ผู้นับ
 *  - ยอดนับแก้ไม่ได้ — นับผิด = ผู้ยืนยัน "ตีกลับให้นับใหม่" (แถวเดิมเป็นประวัติ)
 *  - รอบนี้ **ไม่ลงบัญชีอัตโนมัติ** (เงินขาด/เกิน + การย้ายเงินไปธนาคาร รอผู้สอบบัญชี) และ **ไม่ล็อกการขาย**
 */
const COUNTER_ROLES = ['SALES', 'BRANCH_MANAGER'];
const CONFIRMER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
const MIN_REASON_LENGTH = 5;
const CENT = new Prisma.Decimal('0.005');

/** การปิดยอดที่ "ยังมีผล" — เป็นขอบรอบของครั้งถัดไป. แถวที่ถูกตีกลับไม่นับ */
export const EFFECTIVE_CASH_CLOSE_STATUSES: ShopCashCloseStatus[] = ['PENDING_CONFIRM', 'CONFIRMED'];

type CashCloseReader = Pick<PrismaService, 'shopTender' | 'shopCashClose' | 'branch'>;

/**
 * สาขาที่เมื่อวาน (เวลาไทย) มีเงินสดรับ แต่ยังไม่มีการปิดยอดที่ยังมีผลครอบเงินก้อนนั้น.
 * ใช้ร่วมกันสองที่ — แถบเตือนของแท็บประวัติการปิดยอด และกล่องเตือนของแดชบอร์ด — ห้ามมีสูตรที่สอง
 */
export async function findUnclosedYesterday(db: CashCloseReader, now: Date, branchId?: string) {
  const today = bkkDayRange(bangkokDateString(now));
  const yesterdayStart = new Date(today.start.getTime() - 24 * 60 * 60 * 1000);
  const cashIn = await db.shopTender.groupBy({
    by: ['branchId'],
    where: { ...(branchId ? { branchId } : {}), method: 'CASH', direction: 'IN', occurredAt: { gte: yesterdayStart, lt: today.start } },
    _sum: { amount: true }, _max: { occurredAt: true },
  });
  const result: { branchId: string; branchName: string; date: string; cashIn: number }[] = [];
  for (const group of cashIn) {
    const covering = await db.shopCashClose.findFirst({
      where: { branchId: group.branchId, status: { in: EFFECTIVE_CASH_CLOSE_STATUSES }, countedAt: { gte: group._max.occurredAt! } }, select: { id: true },
    });
    if (covering) continue;
    const branch = await db.branch.findUnique({ where: { id: group.branchId }, select: { name: true } });
    result.push({ branchId: group.branchId, branchName: branch?.name ?? '-', date: bangkokDateString(yesterdayStart),
      cashIn: Number(group._sum.amount ?? 0) });
  }
  return result;
}

/** ยอดที่นับแล้วแต่รอยืนยันรับเงินเกิน 1 วัน — เงื่อนไขเดียวกันทั้งแท็บประวัติและแดชบอร์ด */
export const staleAwaitingConfirmWhere = (now: Date, branchId?: string): Prisma.ShopCashCloseWhereInput => ({
  ...(branchId ? { branchId } : {}), status: 'PENDING_CONFIRM', countedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
});


const CLOSE_INCLUDE = {
  branch: { select: { id: true, name: true } },
  countedBy: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, name: true } },
  sentBackBy: { select: { id: true, name: true } },
} satisfies Prisma.ShopCashCloseInclude;

type CloseRow = Prisma.ShopCashCloseGetPayload<{ include: typeof CLOSE_INCLUDE }>;
type Db = Prisma.TransactionClient | PrismaService;

const money = (value: Prisma.Decimal | null | undefined) => (value == null ? null : Number(value));

@Injectable()
export class ShopCashCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── สิทธิ์ ────────────────────────────────────────────────────────────────

  /** ดูกล่องปิดยอดของสาขา: ข้ามสาขาได้ = เจ้าของ/ผจก.การเงิน/บัญชี · ที่เหลือเห็นเฉพาะสาขาตัวเอง (ไม่มีสาขาติดตัว = ปฏิเสธ) */
  private assertCanView(actor: CashCloseActor, branchId: string) {
    if (hasCrossBranchAccess(actor)) return;
    if (!actor.branchId || actor.branchId !== branchId) {
      throw new ForbiddenException('ดูการปิดยอดได้เฉพาะสาขาของตัวเอง');
    }
  }

  private canCount(actor: CashCloseActor, branchId: string) {
    return COUNTER_ROLES.includes(actor.role) && !!actor.branchId && actor.branchId === branchId;
  }

  private canConfirmBranch(actor: CashCloseActor, branchId: string) {
    if (!CONFIRMER_ROLES.includes(actor.role)) return false;
    if (actor.role === 'BRANCH_MANAGER') return !!actor.branchId && actor.branchId === branchId;
    return true;
  }

  // ─── คำนวณรอบ ──────────────────────────────────────────────────────────────

  /** รอบปัจจุบันของสาขา = ตั้งแต่ปิดยอดที่ยังมีผลครั้งก่อน (ไม่รวม) ถึง `until` (รวม) — เงินสดเท่านั้น */
  private async computeRound(db: Db, branchId: string, until: Date) {
    const branch = await db.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true, name: true, shopCashFloat: true } });
    if (!branch) throw new NotFoundException('ไม่พบสาขา');
    const last = await db.shopCashClose.findFirst({
      where: { branchId, status: { in: EFFECTIVE_CASH_CLOSE_STATUSES } }, orderBy: { countedAt: 'desc' }, select: { id: true, countedAt: true },
    });
    const periodStart = last?.countedAt ?? null;
    const sums = await db.shopTender.groupBy({
      by: ['direction'],
      where: { branchId, method: 'CASH', occurredAt: { ...(periodStart ? { gt: periodStart } : {}), lte: until } },
      _sum: { amount: true }, _count: { _all: true },
    });
    const pick = (direction: 'IN' | 'OUT') => sums.find((row) => row.direction === direction);
    const cashIn = pick('IN')?._sum.amount ?? new Prisma.Decimal(0);
    const cashOut = pick('OUT')?._sum.amount ?? new Prisma.Decimal(0);
    const movementCount = (pick('IN')?._count._all ?? 0) + (pick('OUT')?._count._all ?? 0);
    const floatAmount = branch.shopCashFloat;
    return { branch, periodStart, floatAmount, cashIn, cashOut, movementCount, hasPreviousClose: !!last,
      expectedAmount: floatAmount.plus(cashIn).minus(cashOut) };
  }

  private present(row: CloseRow) {
    return {
      id: row.id, branchId: row.branchId, branchName: row.branch.name, status: row.status, attemptNo: row.attemptNo,
      periodStart: row.periodStart, countedAt: row.countedAt,
      floatAmount: money(row.floatAmount), cashIn: money(row.cashIn), cashOut: money(row.cashOut),
      expectedAmount: money(row.expectedAmount), countedAmount: money(row.countedAmount),
      varianceAmount: money(row.varianceAmount), varianceReason: row.varianceReason, sendAmount: money(row.sendAmount),
      countedBy: row.countedBy,
      receivedAmount: money(row.receivedAmount), receiveVariance: money(row.receiveVariance), receiveNote: row.receiveNote,
      destination: row.destination, confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt,
      sentBackBy: row.sentBackBy, sentBackAt: row.sentBackAt, sentBackReason: row.sentBackReason,
    };
  }

  // ─── อ่าน ─────────────────────────────────────────────────────────────────

  /** กล่อง "ปิดยอดวันนี้" ของสาขาเดียว — ยอดรอบปัจจุบัน (สด ณ ตอนนี้) + การนับของวันที่เลือก */
  async getStatus(actor: CashCloseActor, query: { branchId: string; date?: string }) {
    this.assertCanView(actor, query.branchId);
    const now = new Date();
    const date = query.date || bangkokDateString(now);
    const { start, end } = bkkDayRange(date);
    const round = await this.computeRound(this.prisma, query.branchId, now);
    const closes = await this.prisma.shopCashClose.findMany({
      where: { branchId: query.branchId, countedAt: { gte: start, lt: end } }, include: CLOSE_INCLUDE, orderBy: { countedAt: 'desc' },
    });
    const awaiting = await this.prisma.shopCashClose.findMany({
      where: { branchId: query.branchId, status: 'PENDING_CONFIRM' }, include: CLOSE_INCLUDE, orderBy: { countedAt: 'asc' },
    });
    return {
      date, asOf: now, branchId: round.branch.id, branchName: round.branch.name,
      round: { periodStart: round.periodStart, floatAmount: money(round.floatAmount), cashIn: money(round.cashIn),
        cashOut: money(round.cashOut), expectedAmount: money(round.expectedAmount), movementCount: round.movementCount },
      closes: closes.map((row) => this.present(row)),
      awaitingConfirm: awaiting.map((row) => this.present(row)),
      permissions: {
        canCount: this.canCount(actor, query.branchId),
        canConfirm: this.canConfirmBranch(actor, query.branchId),
        viewerId: actor.id,
      },
    };
  }

  /** ประวัติการปิดยอด + แถบเตือน (เจ้าของ/ผจก.การเงิน/บัญชี = ทุกสาขา · ผจก.สาขา = สาขาตัวเอง) */
  async getHistory(actor: CashCloseActor, query: { branchId?: string; month?: string }) {
    let branchId = query.branchId || undefined;
    if (!hasCrossBranchAccess(actor)) {
      if (actor.role !== 'BRANCH_MANAGER' || !actor.branchId || (branchId && branchId !== actor.branchId)) {
        throw new ForbiddenException('ดูประวัติการปิดยอดได้เฉพาะสาขาของตัวเอง');
      }
      branchId = actor.branchId;
    }
    const now = new Date();
    const month = /^\d{4}-\d{2}$/.test(query.month ?? '') ? query.month! : bangkokDateString(now).slice(0, 7);
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const { gte, lt } = bangkokDateRange(`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
    const branchWhere = branchId ? { branchId } : {};

    const rows = await this.prisma.shopCashClose.findMany({
      where: { ...branchWhere, countedAt: { gte, lt } }, include: CLOSE_INCLUDE, orderBy: { countedAt: 'desc' }, take: 500,
    });

    // เงินขาดสะสมของเดือน — นับเฉพาะการปิดยอดที่ยังมีผล (แถวที่ถูกตีกลับคือการนับที่ถูกแทนที่แล้ว)
    const shortageMap = new Map<string, { branchId: string; branchName: string; count: number; amount: Prisma.Decimal }>();
    for (const row of rows) {
      if (!EFFECTIVE_CASH_CLOSE_STATUSES.includes(row.status) || !row.varianceAmount.lt(0)) continue;
      const entry = shortageMap.get(row.branchId) ?? { branchId: row.branchId, branchName: row.branch.name, count: 0, amount: new Prisma.Decimal(0) };
      entry.count += 1; entry.amount = entry.amount.plus(row.varianceAmount.abs());
      shortageMap.set(row.branchId, entry);
    }

    const stale = await this.prisma.shopCashClose.findMany({
      where: staleAwaitingConfirmWhere(now, branchId), include: CLOSE_INCLUDE, orderBy: { countedAt: 'asc' },
    });

    return {
      month, branchId: branchId ?? null,
      rows: rows.map((row) => this.present(row)),
      alerts: {
        unclosedYesterday: await findUnclosedYesterday(this.prisma, now, branchId),
        monthShortage: [...shortageMap.values()].map((entry) => ({ ...entry, amount: Number(entry.amount) })),
        awaitingOverOneDay: stale.map((row) => this.present(row)),
      },
    };
  }

  // ─── เขียน ────────────────────────────────────────────────────────────────

  /** พนักงานนับเงินปิดยอด — snapshot ยอดรอบ ณ ตอนนับ ภายใต้ล็อกของสาขา (กันสองคนนับพร้อมกัน/กดซ้ำ) */
  async count(actor: CashCloseActor, input: { branchId: string; countedAmount: number; varianceReason?: string | null }) {
    if (!COUNTER_ROLES.includes(actor.role)) {
      throw new ForbiddenException('ผู้นับเงินปิดยอดต้องเป็นพนักงานขายหรือผู้จัดการสาขาของสาขานั้น');
    }
    if (!this.canCount(actor, input.branchId)) {
      throw new ForbiddenException('นับเงินปิดยอดได้เฉพาะสาขาของตัวเอง');
    }
    const counted = new Prisma.Decimal(input.countedAmount).toDecimalPlaces(2);
    const reason = input.varianceReason?.trim() || null;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'shop-cash-close:' + input.branchId}))`;
      const now = new Date();
      const round = await this.computeRound(tx, input.branchId, now);
      if (round.hasPreviousClose && round.movementCount === 0) {
        throw new BadRequestException('ยังไม่มีรายการเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน — ไม่ต้องนับซ้ำ');
      }
      const variance = counted.minus(round.expectedAmount);
      if (variance.abs().gte(CENT) && (!reason || reason.length < MIN_REASON_LENGTH)) {
        throw new BadRequestException(`ยอดที่นับได้ไม่ตรงกับยอดที่ต้องมี — กรอกเหตุผลของส่วนต่างก่อนบันทึก (อย่างน้อย ${MIN_REASON_LENGTH} ตัวอักษร)`);
      }
      const latest = await tx.shopCashClose.findFirst({ where: { branchId: input.branchId }, orderBy: { countedAt: 'desc' },
        select: { status: true, attemptNo: true } });
      const sendAmount = Prisma.Decimal.max(counted.minus(round.floatAmount), 0);
      return tx.shopCashClose.create({
        data: {
          branchId: input.branchId, attemptNo: latest?.status === 'SENT_BACK' ? latest.attemptNo + 1 : 1,
          periodStart: round.periodStart, floatAmount: round.floatAmount, cashIn: round.cashIn, cashOut: round.cashOut,
          expectedAmount: round.expectedAmount, countedAmount: counted, varianceAmount: variance,
          varianceReason: variance.abs().gte(CENT) ? reason : null, sendAmount, countedById: actor.id, countedAt: now,
        },
        include: CLOSE_INCLUDE,
      });
    });

    await this.audit.log({ userId: actor.id, action: 'SHOP_CASH_CLOSE_COUNTED', entity: 'shop_cash_close', entityId: created.id,
      newValue: { branchId: created.branchId, attemptNo: created.attemptNo, expectedAmount: created.expectedAmount,
        countedAmount: created.countedAmount, varianceAmount: created.varianceAmount, varianceReason: created.varianceReason,
        sendAmount: created.sendAmount } });
    return this.present(created);
  }

  /** โหลดแถวใต้ล็อกสาขา + ตรวจสิทธิ์ผู้ยืนยัน (ใช้ร่วมกันระหว่างยืนยันรับเงินกับตีกลับ) */
  private async loadForDecision(tx: Prisma.TransactionClient, actor: CashCloseActor, id: string) {
    const peek = await tx.shopCashClose.findUnique({ where: { id }, select: { branchId: true } });
    if (!peek) throw new NotFoundException('ไม่พบรายการปิดยอด');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'shop-cash-close:' + peek.branchId}))`;
    const row = await tx.shopCashClose.findUniqueOrThrow({ where: { id } });
    if (!this.canConfirmBranch(actor, row.branchId)) {
      throw new ForbiddenException('ผู้ยืนยันรับเงินต้องเป็นเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาของสาขานั้น');
    }
    if (row.countedById === actor.id) {
      throw new ForbiddenException('ผู้ยืนยันรับเงินต้องไม่ใช่คนเดียวกับผู้นับ — ให้เจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาคนอื่นเป็นผู้ยืนยัน');
    }
    if (row.status !== 'PENDING_CONFIRM') {
      throw new ConflictException(row.status === 'CONFIRMED' ? 'รายการนี้ยืนยันรับเงินไปแล้ว' : 'รายการนี้ถูกตีกลับให้นับใหม่แล้ว');
    }
    return row;
  }

  async confirm(actor: CashCloseActor, id: string, input: { receivedAmount: number; destination: ShopCashDestination; note?: string | null }) {
    const received = new Prisma.Decimal(input.receivedAmount).toDecimalPlaces(2);
    const note = input.note?.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadForDecision(tx, actor, id);
      const receiveVariance = received.minus(row.sendAmount);
      if (receiveVariance.abs().gte(CENT) && (!note || note.length < MIN_REASON_LENGTH)) {
        throw new BadRequestException(`เงินที่รับมาจริงไม่เท่ายอดที่พนักงานแจ้งส่ง — กรอกหมายเหตุของส่วนต่างก่อนยืนยัน (อย่างน้อย ${MIN_REASON_LENGTH} ตัวอักษร)`);
      }
      return tx.shopCashClose.update({
        where: { id },
        data: { status: 'CONFIRMED', receivedAmount: received, receiveVariance, receiveNote: note, destination: input.destination,
          confirmedById: actor.id, confirmedAt: new Date() },
        include: CLOSE_INCLUDE,
      });
    });
    await this.audit.log({ userId: actor.id, action: 'SHOP_CASH_CLOSE_CONFIRMED', entity: 'shop_cash_close', entityId: id,
      newValue: { branchId: updated.branchId, sendAmount: updated.sendAmount, receivedAmount: updated.receivedAmount,
        receiveVariance: updated.receiveVariance, receiveNote: updated.receiveNote, destination: updated.destination,
        countedById: updated.countedById } });
    return this.present(updated);
  }

  async sendBack(actor: CashCloseActor, id: string, input: { reason: string }) {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < MIN_REASON_LENGTH) {
      throw new BadRequestException(`กรอกเหตุผลที่ตีกลับให้นับใหม่ (อย่างน้อย ${MIN_REASON_LENGTH} ตัวอักษร)`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadForDecision(tx, actor, id);
      // ตีกลับได้เฉพาะการปิดยอดครั้งล่าสุดของสาขา — ครั้งที่มีการปิดยอดใหม่ทับแล้วเป็นขอบรอบของครั้งถัดไป
      // ถ้าถอนออก เงินของรอบนั้นจะไม่ถูกนับอีกเลย
      const newer = await tx.shopCashClose.findFirst({
        where: { branchId: row.branchId, status: { in: EFFECTIVE_CASH_CLOSE_STATUSES }, countedAt: { gt: row.countedAt } }, select: { id: true },
      });
      if (newer) {
        throw new BadRequestException('ตีกลับได้เฉพาะการปิดยอดครั้งล่าสุดของสาขา — ครั้งนี้มีการปิดยอดใหม่ทับแล้ว ให้กด "ยืนยันรับเงิน" ตามเงินที่รับจริงและระบุส่วนต่างในหมายเหตุ');
      }
      return tx.shopCashClose.update({
        where: { id }, data: { status: 'SENT_BACK', sentBackById: actor.id, sentBackAt: new Date(), sentBackReason: reason },
        include: CLOSE_INCLUDE,
      });
    });
    await this.audit.log({ userId: actor.id, action: 'SHOP_CASH_CLOSE_SENT_BACK', entity: 'shop_cash_close', entityId: id,
      newValue: { branchId: updated.branchId, attemptNo: updated.attemptNo, countedAmount: updated.countedAmount, reason,
        countedById: updated.countedById } });
    return this.present(updated);
  }
}
