import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Prisma, ShopCashCloseStatus, ShopCashDestination } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { bangkokDateRange, bangkokDateString } from '../../utils/date.util';
import { bkkDayRange } from './shop-tenders-report.service';
import { JeLineInput, JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { assertEvidenceImage, evidenceImageExtension } from '../../utils/upload-image.util';
import { CashCloseActor, COUNTER_ROLES, canConfirmBranch, canCountBranch, canViewBranch } from './shop-cash-access';
import { CASH_CLOSE_DESTINATION_ACCOUNT, CASH_OVER_SHORT_ACCOUNT, SHOP_CASH_CLOSE_FLOW } from './shop-cash-accounts';
import { ShopCashHoldingService } from './shop-cash-holding.service';
import { MAX_REFERENCE_LENGTH, MIN_REFERENCE_LENGTH } from './shop-tender.util';

export type { CashCloseActor } from './shop-cash-access';
export { CASH_CLOSE_DESTINATION_ACCOUNT, CASH_OVER_SHORT_ACCOUNT, SHOP_CASH_CLOSE_FLOW } from './shop-cash-accounts';

/**
 * นับเงินปิดยอดลิ้นชักของสาขา — คำตัดสินเจ้าของ 2026-09-20 (mockup กระดาน 7–9, เคาะตามข้อเสนอทั้งหมด):
 *  - หนึ่งสาขา = หนึ่งลิ้นชัก · ปิดยอดแล้วส่งเงินทั้งหมด เหลือ "เงินทอนตั้งต้น" คงที่ (`Branch.shopCashFloat`)
 *  - ต้องมีในลิ้นชัก = เงินทอนตั้งต้น + รับเงินสด − จ่ายเงินสดออก นับตั้งแต่ปิดยอดครั้งก่อนถึงตอนนับ (อ่านจาก `shop_tenders`)
 *  - ผู้นับ = พนักงานขาย/ผจก.สาขาของสาขานั้น (คนที่ล็อกอิน) · ผู้ยืนยัน = เจ้าของ/ผจก.การเงิน/ผจก.สาขา และต้องไม่ใช่ผู้นับ
 *  - ยอดนับแก้ไม่ได้ — นับผิด = ผู้ยืนยัน "ตีกลับให้นับใหม่" (แถวเดิมเป็นประวัติ)
 *  - ลงบัญชีใบเดียวตอนยืนยันรับเงิน (2026-09-21 — `postConfirmJournal`) · **ไม่ล็อกการขาย** (เมื่อวานไม่ปิดยอด = แถบเตือนบนหน้าขายเท่านั้น)
 *  - หลักฐานว่าเงินถึงบริษัท (2026-09-21 รอบ 5): นำฝากธนาคาร = รูปสลิป + เลขอ้างอิง · "เจ้าของเก็บไว้" = เจ้าของยืนยันเอง ·
 *    ตู้เซฟสาขา = ยังไม่ถึงบริษัท จนกว่าจะบันทึกนำฝาก (`ShopCashHoldingService`)
 */
const MIN_REASON_LENGTH = 5;
const CENT = new Prisma.Decimal('0.005');

/**
 * เงินของการปิดยอดครั้งนั้น "ถึงบริษัทแล้วหรือยัง" (คำตัดสินเจ้าของ 2026-09-21 กระดาน 10–11):
 * นำฝากธนาคาร (มีสลิป) / เจ้าของเก็บไว้ (เจ้าของยืนยันเอง) = ถึงแล้ว · ตู้เซฟสาขา = ยังอยู่ที่สาขา จนกว่ายอดนำฝากสะสมจะครอบ
 */
export type CashCloseMoneyState = 'AWAITING_CONFIRM' | 'REACHED' | 'AT_BRANCH' | 'SENT_BACK';

interface ConfirmJournalResult { entryId: string | null; entryNumber: string | null; skipped: string | null }

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


export const CLOSE_INCLUDE = {
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
  private readonly logger = new Logger(ShopCashCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journal: JournalAutoService,
    private readonly companies: CompanyResolverService,
    private readonly storage: StorageService,
    private readonly holdings: ShopCashHoldingService,
  ) {}

  // ─── สิทธิ์ (กติกาอยู่ที่ `shop-cash-access.ts` — ใช้ร่วมกับการนำฝากและหน้าสถานะทุกสาขา) ────────────

  private assertCanView(actor: CashCloseActor, branchId: string) {
    if (!canViewBranch(actor, branchId)) throw new ForbiddenException('ดูการปิดยอดได้เฉพาะสาขาของตัวเอง');
  }

  private canCount(actor: CashCloseActor, branchId: string) { return canCountBranch(actor, branchId); }

  private canConfirmBranch(actor: CashCloseActor, branchId: string) { return canConfirmBranch(actor, branchId); }

  // ─── คำนวณรอบ ──────────────────────────────────────────────────────────────

  /** รอบปัจจุบันของสาขา = ตั้งแต่ปิดยอดที่ยังมีผลครั้งก่อน (ไม่รวม) ถึง `until` (รวม) — เงินสดเท่านั้น */
  async computeRound(db: Db, branchId: string, until: Date) {
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

  /** `settled` = การปิดยอดที่ยอดนำฝากสะสมครอบแล้ว (`ShopCashHoldingService.settledCloseIds`) — ไม่ส่ง = ถือว่าตู้เซฟยังไม่ได้นำฝาก */
  present(row: CloseRow, settled?: Set<string>) {
    const moneyState: CashCloseMoneyState = row.status === 'SENT_BACK' ? 'SENT_BACK'
      : row.status === 'PENDING_CONFIRM' ? 'AWAITING_CONFIRM'
        : row.destination === 'BRANCH_SAFE' && !settled?.has(row.id) ? 'AT_BRANCH' : 'REACHED';
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
      journalPosted: !!row.journalEntryId,
      depositReference: row.depositReference, hasDepositSlip: !!row.depositSlipKey, moneyState,
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
    const settled = await this.holdings.settledCloseIds([query.branchId]);
    return {
      date, asOf: now, branchId: round.branch.id, branchName: round.branch.name,
      round: { periodStart: round.periodStart, floatAmount: money(round.floatAmount), cashIn: money(round.cashIn),
        cashOut: money(round.cashOut), expectedAmount: money(round.expectedAmount), movementCount: round.movementCount },
      closes: closes.map((row) => this.present(row, settled)),
      awaitingConfirm: awaiting.map((row) => this.present(row, settled)),
      permissions: {
        canCount: this.canCount(actor, query.branchId),
        canConfirm: this.canConfirmBranch(actor, query.branchId),
        viewerId: actor.id, viewerRole: actor.role,
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

    const settled = await this.holdings.settledCloseIds(branchId ? [branchId] : undefined);
    return {
      month, branchId: branchId ?? null,
      rows: rows.map((row) => this.present(row, settled)),
      deposits: await this.holdings.listDeposits({ gte: gte!, lt: lt! }, branchId),
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
    if (created.varianceAmount.abs().gte(CENT)) {
      await this.alarmVariance(actor.id, created, {
        label: 'ปิดยอดเงินสด', variance: created.varianceAmount, by: `นับโดย ${created.countedBy.name}`,
        detail: `ต้องมี ${created.expectedAmount.toFixed(2)} · นับได้ ${created.countedAmount.toFixed(2)} · เหตุผล: ${created.varianceReason ?? '-'}`,
      });
    }
    return this.present(created);
  }

  /**
   * "แจ้งเตือนเจ้าของทุกครั้งที่ปิดยอดมีส่วนต่าง" (ข้อเสนอที่เจ้าของเคาะ 2026-09-20) = งานในหน้า "งานของทีม" (`/todos`) หนึ่งใบต่อครั้ง —
   * ช่องทางเตือนคนในระบบแบบเดียวกับใบลดหนี้ส่งไม่ถึง/กระทบยอดระหว่างกิจการ. เงินขาด = HIGH · เงินเกิน = MEDIUM.
   * เรียก **หลัง commit** เสมอและห้าม throw — การนับ/ยืนยันบันทึกไปแล้ว การเตือนพังต้องไม่ทำให้ผู้ใช้เห็นว่าบันทึกไม่สำเร็จ
   */
  private async alarmVariance(actorId: string, row: CloseRow,
    info: { label: string; variance: Prisma.Decimal; by: string; detail: string }) {
    try {
      const short = info.variance.lt(0);
      await this.prisma.todo.create({
        data: {
          title: `${info.label} ${row.branch.name} ${short ? 'ขาด' : 'เกิน'} ${info.variance.abs().toFixed(2)} ฿ — ${info.by}`,
          description: `${info.detail}\nตรวจที่เมนู "สรุปเงินรายวัน" → แท็บ "ประวัติการปิดยอด" (วันที่ปิด ${bangkokDateString(row.countedAt)})`,
          priority: short ? 'HIGH' : 'MEDIUM', tags: ['cash-close-variance'], branchId: row.branchId, createdById: actorId,
        },
      });
    } catch (error) {
      this.logger.error(`สร้างงานเตือนส่วนต่างปิดยอดไม่สำเร็จ (close ${row.id})`, error instanceof Error ? error.stack : String(error));
      Sentry.captureException(error, { tags: { subsystem: 'shop-cash-close' }, extra: { closeId: row.id } });
    }
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

  /**
   * แนบรูปสลิปฝากเงินให้การปิดยอดที่รอยืนยัน — ทำก่อนกด "ยืนยันรับเงิน" เมื่อปลายทาง = นำฝากธนาคาร (บังคับ).
   * ผู้แนบ = ผู้มีสิทธิ์ยืนยันของสาขานั้นและไม่ใช่ผู้นับ (กติกาเดียวกับการยืนยัน) · แนบใหม่ = แทนรูปเดิม
   */
  async attachDepositSlip(actor: CashCloseActor, id: string, file: Express.Multer.File | undefined) {
    assertEvidenceImage(file, 'สลิปฝากเงิน');
    const row = await this.prisma.shopCashClose.findUnique({ where: { id }, select: { branchId: true, countedById: true, status: true, depositSlipKey: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการปิดยอด');
    if (!this.canConfirmBranch(actor, row.branchId) || row.countedById === actor.id) {
      throw new ForbiddenException('แนบสลิปฝากเงินได้เฉพาะผู้ยืนยันรับเงินของสาขานั้น และต้องไม่ใช่ผู้นับ');
    }
    if (row.status !== 'PENDING_CONFIRM') throw new ConflictException('แนบสลิปได้เฉพาะรายการที่ยังรอยืนยันรับเงิน');
    const key = `shop-cash-close/${id}/${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    try {
      // เงื่อนไขสถานะใน where: ถ้ามีคนยืนยัน/ตีกลับไปแล้วระหว่างอัปโหลด รูปนี้ต้องไม่ไปเกาะรายการที่ปิดแล้ว
      const result = await this.prisma.shopCashClose.updateMany({ where: { id, status: 'PENDING_CONFIRM' }, data: { depositSlipKey: key } });
      if (result.count === 0) throw new ConflictException('รายการนี้ถูกยืนยันหรือตีกลับไปแล้ว');
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (row.depositSlipKey) await this.storage.delete(row.depositSlipKey).catch(() => undefined);
    return { id, hasDepositSlip: true };
  }

  /** รูปสลิปฝากเงินของการปิดยอด — ขอบเขตสาขาเดียวกับการดูกล่องปิดยอด (route จำกัด role แล้ว) */
  async getDepositSlip(actor: CashCloseActor, id: string) {
    const row = await this.prisma.shopCashClose.findUnique({ where: { id }, select: { branchId: true, depositSlipKey: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการปิดยอด');
    this.assertCanView(actor, row.branchId);
    if (!row.depositSlipKey) throw new NotFoundException('รายการนี้ไม่มีรูปสลิปฝากเงิน');
    return { key: row.depositSlipKey, stream: await this.storage.getStream(row.depositSlipKey) };
  }

  async confirm(actor: CashCloseActor, id: string,
    input: { receivedAmount: number; destination: ShopCashDestination; note?: string | null; depositReference?: string | null }) {
    const received = new Prisma.Decimal(input.receivedAmount).toDecimalPlaces(2);
    const note = input.note?.trim() || null;
    const depositReference = input.depositReference?.trim() || null;
    let journal: ConfirmJournalResult = { entryId: null, entryNumber: null, skipped: null };
    const cleanup: { slipKey: string | null } = { slipKey: null };
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.loadForDecision(tx, actor, id);
      // "เจ้าของเก็บไว้" = เงินถึงมือเจ้าของ ⇒ คนที่กดยืนยันต้องเป็นเจ้าของเอง (เดิมผู้จัดการเลือกแทนได้โดยไม่มีอะไรยืนยัน)
      if (input.destination === 'OWNER_HOLD' && actor.role !== 'OWNER') {
        throw new ForbiddenException('เลือก "เจ้าของเก็บไว้" ได้เฉพาะเมื่อเจ้าของเป็นผู้กดยืนยันรับเงินเอง — ผู้จัดการให้เลือก "นำฝากธนาคารของร้าน" หรือ "ตู้เซฟสาขา"');
      }
      const receiveVariance = received.minus(row.sendAmount);
      if (receiveVariance.abs().gte(CENT) && (!note || note.length < MIN_REASON_LENGTH)) {
        throw new BadRequestException(`เงินที่รับมาจริงไม่เท่ายอดที่พนักงานแจ้งส่ง — กรอกหมายเหตุของส่วนต่างก่อนยืนยัน (อย่างน้อย ${MIN_REASON_LENGTH} ตัวอักษร)`);
      }
      const needsSlip = input.destination === 'BANK_DEPOSIT' && received.gte(CENT);
      if (needsSlip) {
        if (!row.depositSlipKey) throw new BadRequestException('นำฝากธนาคารต้องแนบรูปสลิปฝากเงินก่อนยืนยัน');
        if (!depositReference || depositReference.length < MIN_REFERENCE_LENGTH || depositReference.length > MAX_REFERENCE_LENGTH) {
          throw new BadRequestException(`กรอกเลขอ้างอิงในสลิปฝากเงิน (${MIN_REFERENCE_LENGTH}–${MAX_REFERENCE_LENGTH} ตัว)`);
        }
      } else if (row.depositSlipKey) {
        cleanup.slipKey = row.depositSlipKey; // แนบไว้แล้วเปลี่ยนปลายทาง — ไม่เก็บรูปที่ไม่เกี่ยวกับการปิดยอดครั้งนี้
      }
      const confirmedAt = new Date();
      const confirmed = await tx.shopCashClose.update({
        where: { id },
        data: { status: 'CONFIRMED', receivedAmount: received, receiveVariance, receiveNote: note, destination: input.destination,
          depositReference: needsSlip ? depositReference : null, ...(needsSlip ? {} : { depositSlipKey: null }),
          confirmedById: actor.id, confirmedAt },
        include: CLOSE_INCLUDE,
      });
      // ลงบัญชีใน tx เดียวกับการยืนยัน — JE พัง = การยืนยันไม่เกิด (ไม่มีสถานะ "ยืนยันแล้วแต่สมุดไม่ขยับ" ที่ไม่มีใครรู้)
      journal = await this.postConfirmJournal(tx, confirmed, confirmedAt);
      if (!journal.entryId) return confirmed;
      return tx.shopCashClose.update({ where: { id }, data: { journalEntryId: journal.entryId }, include: CLOSE_INCLUDE });
    });
    if (cleanup.slipKey) await this.storage.delete(cleanup.slipKey).catch(() => undefined);
    if (journal.skipped) {
      Sentry.captureMessage('[shop-cash-close] confirmed without a journal entry', {
        level: 'warning', tags: { subsystem: 'shop-cash-close' }, extra: { closeId: id, reason: journal.skipped } });
    }
    await this.audit.log({ userId: actor.id, action: 'SHOP_CASH_CLOSE_CONFIRMED', entity: 'shop_cash_close', entityId: id,
      newValue: { branchId: updated.branchId, sendAmount: updated.sendAmount, receivedAmount: updated.receivedAmount,
        receiveVariance: updated.receiveVariance, receiveNote: updated.receiveNote, destination: updated.destination,
        depositReference: updated.depositReference, hasDepositSlip: !!updated.depositSlipKey,
        countedById: updated.countedById, journalEntryNumber: journal.entryNumber, journalSkipped: journal.skipped } });
    if (updated.receiveVariance && updated.receiveVariance.abs().gte(CENT)) {
      await this.alarmVariance(actor.id, updated, {
        label: 'รับเงินปิดยอด', variance: updated.receiveVariance, by: `รับโดย ${updated.confirmedBy?.name ?? '-'} (นับโดย ${updated.countedBy.name})`,
        detail: `พนักงานแจ้งส่ง ${updated.sendAmount.toFixed(2)} · รับจริง ${updated.receivedAmount?.toFixed(2) ?? '-'} · หมายเหตุ: ${updated.receiveNote ?? '-'}`,
      });
    }
    return this.present(updated, await this.holdings.settledCloseIds([updated.branchId]));
  }

  /**
   * JE ตอนยืนยันรับเงิน — คำตัดสินเจ้าของ 2026-09-21: เงินขาด/เกินลง **บัญชีเดียว** `S53-1104 เงินขาด-เกินบัญชี` (รวมส่วนต่างชั้นที่สอง)
   * และการย้ายเงินออกจากลิ้นชักลง **ทุกปลายทาง ณ วันที่ผู้รับยืนยัน**. ไม่ลงอะไรตอนนับ — ยอดนับถูกตีกลับได้ จึงไม่มี JE ให้ต้องกลับรายการ.
   *
   *   นับขาด |V|   : Dr S53-1104 / Cr ลิ้นชัก        นับเกิน V   : Dr ลิ้นชัก / Cr S53-1104
   *   ส่งเงินออก    : Dr ปลายทาง [รับจริง] / Cr ลิ้นชัก [แจ้งส่ง]   · ต่างกัน = S53-1104 (ขาด Dr · เกิน Cr)
   *
   * รวมยอดต่อบัญชีแล้วออกบรรทัดเดียวต่อบัญชี ⇒ สมดุลโดยโครงสร้าง และกรณีลิ้นชักกับปลายทางเป็นบัญชีเดียวกัน
   * (สาขาที่ตั้งบัญชีธนาคารเป็นลิ้นชัก) ขาย้ายเงินหักล้างกันเองไม่เกิดบรรทัด Dr/Cr บัญชีเดียวกัน.
   * หลังใบนี้ ยอดบัญชีลิ้นชักในสมุด = เงินทอนตั้งต้น (เมื่อสมุดเดินตรงกับสมุดเงินหน้าร้านมาตลอด).
   * ผังไม่พร้อม (สาขายังไม่ตั้งลิ้นชัก / บัญชีใหม่ยังไม่มีในผัง) = ข้ามพร้อมเหตุผล ไม่บล็อกการรับเงิน — แบบเดียวกับ `externalFinanceAccountsReady`.
   */
  private async postConfirmJournal(tx: Prisma.TransactionClient, row: CloseRow, confirmedAt: Date): Promise<ConfirmJournalResult> {
    const none: ConfirmJournalResult = { entryId: null, entryNumber: null, skipped: null };
    const branch = await tx.branch.findUnique({ where: { id: row.branchId }, select: { shopCashAccountCode: true } });
    const drawer = branch?.shopCashAccountCode ?? null;
    const destination = row.destination ? CASH_CLOSE_DESTINATION_ACCOUNT[row.destination] : null;
    const received = row.receivedAmount ?? new Prisma.Decimal(0);

    const net = new Map<string, Prisma.Decimal>(); // บวก = Dr · ลบ = Cr
    const move = (code: string, amount: Prisma.Decimal) => net.set(code, (net.get(code) ?? new Prisma.Decimal(0)).plus(amount));
    const DRAWER = '__drawer__', DEST = '__destination__';
    move(DRAWER, row.varianceAmount); move(CASH_OVER_SHORT_ACCOUNT, row.varianceAmount.neg());
    move(DRAWER, row.sendAmount.neg()); move(DEST, received);
    move(CASH_OVER_SHORT_ACCOUNT, row.sendAmount.minus(received));
    if (drawer && destination === drawer) { move(DRAWER, net.get(DEST) ?? new Prisma.Decimal(0)); net.delete(DEST); }
    const entries = [...net.entries()].filter(([, amount]) => amount.abs().gte(CENT));
    if (entries.length === 0) return none; // นับตรง ไม่มีเงินส่ง = ไม่มีอะไรให้ลง

    if (!drawer) return { ...none, skipped: 'NO_DRAWER_ACCOUNT' };
    if (entries.some(([code]) => code === DEST) && !destination) return { ...none, skipped: 'NO_DESTINATION' };
    const label: Record<string, string> = {
      [DRAWER]: 'ลิ้นชักเงินสดสาขา', [DEST]: row.destination ? `ปลายทางเงินปิดยอด (${row.destination})` : 'ปลายทางเงินปิดยอด',
      [CASH_OVER_SHORT_ACCOUNT]: 'เงินขาด-เกินจากการนับ/รับเงินปิดยอด',
    };
    const lines: JeLineInput[] = entries.map(([code, amount]) => ({
      accountCode: code === DRAWER ? drawer : code === DEST ? destination! : code,
      dr: amount.gt(0) ? amount : new Prisma.Decimal(0), cr: amount.lt(0) ? amount.neg() : new Prisma.Decimal(0),
      description: label[code] ?? code,
    }));
    const codes = [...new Set(lines.map((line) => line.accountCode))];
    const known = await tx.chartOfAccount.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { code: true } });
    if (known.length !== codes.length) return { ...none, skipped: 'ACCOUNTS_NOT_IN_CHART' };

    const companyId = await this.companies.getShopCompanyId(tx);
    await validatePeriodOpen(tx, confirmedAt, companyId);
    const entry = await this.journal.createAndPost({
      description: `ปิดยอดเงินสด ${row.branch.name} ${bangkokDateString(row.countedAt)} — นับ ${row.countedAmount.toFixed(2)} (${row.varianceAmount.gte(0) ? '+' : ''}${row.varianceAmount.toFixed(2)}) · ส่ง ${row.sendAmount.toFixed(2)} · รับจริง ${received.toFixed(2)}`,
      reference: `shop-cash-close:${row.id}`,
      metadata: {
        flow: SHOP_CASH_CLOSE_FLOW, idempotencyKey: `${SHOP_CASH_CLOSE_FLOW}:${row.id}`, shopCashCloseId: row.id, branchId: row.branchId,
        destination: row.destination, varianceAmount: row.varianceAmount.toFixed(2), sendAmount: row.sendAmount.toFixed(2),
        receivedAmount: received.toFixed(2), receiveVariance: received.minus(row.sendAmount).toFixed(2),
      },
      postedAt: confirmedAt, companyId, lines,
    }, tx);
    return { entryId: entry.id, entryNumber: entry.entryNumber, skipped: null };
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
