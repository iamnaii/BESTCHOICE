import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { bangkokDateString } from '../../utils/date.util';
import { bkkDayRange } from './shop-tenders-report.service';
import { CashCloseActor, canConfirmBranch, canCountBranch, canViewBranch } from './shop-cash-access';
import { CLOSE_INCLUDE, EFFECTIVE_CASH_CLOSE_STATUSES, ShopCashCloseService, findUnclosedYesterday } from './shop-cash-close.service';
import { ShopCashHoldingService } from './shop-cash-holding.service';

/** สถานะของ "หนึ่งวันของหนึ่งสาขา" — ใช้ทั้งตารางสถานะของวันและแถบ 14 วัน (กระดาน 10) */
export type CashCloseDayState = 'REACHED' | 'AT_BRANCH' | 'AWAITING_CONFIRM' | 'NOT_COUNTED' | 'MISSED' | 'NO_CASH';

export const CASH_CLOSE_STRIP_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** ครั้งที่แย่ที่สุดของวันเป็นตัวแทนของวันนั้น: รอยืนยัน > ยังอยู่ที่สาขา > ถึงบริษัทแล้ว */
const STATE_RANK: Record<'AWAITING_CONFIRM' | 'AT_BRANCH' | 'REACHED', number> = { AWAITING_CONFIRM: 3, AT_BRANCH: 2, REACHED: 1 };

const dateList = (endDate: string, days: number) => {
  const end = bkkDayRange(endDate).start.getTime();
  return Array.from({ length: days }, (_, index) => bangkokDateString(new Date(end - (days - 1 - index) * DAY_MS)));
};

/**
 * สถานะของแต่ละวัน ณ สิ้นวันนั้น (วันนี้ = ณ ตอนนี้):
 *   มีการปิดยอดที่ยังมีผลในวันนั้น → สถานะของครั้งที่แย่ที่สุด
 *   ไม่มี แต่มีเงินสดรับที่ยังไม่ถูกนับค้างอยู่ตอนสิ้นวัน → MISSED (วันนี้ = NOT_COUNTED)
 *   นอกนั้น → NO_CASH
 * "ค้างอยู่ตอนสิ้นวัน" รวมเงินที่รับหลังปิดยอดของวันก่อน ⇒ วันที่ไม่มีการขายแต่ลิ้นชักยังมีเงินที่ไม่มีใครนับ ขึ้นสีแดงด้วย
 */
export function dayStates(input: {
  dates: string[]; today: string; now: Date;
  closes: { countedAt: Date; state: keyof typeof STATE_RANK }[];
  cashInTimes: Date[];
}): CashCloseDayState[] {
  const closes = [...input.closes].sort((a, b) => a.countedAt.getTime() - b.countedAt.getTime());
  const cash = input.cashInTimes.map((time) => time.getTime()).sort((a, b) => a - b);
  return input.dates.map((date) => {
    const { start, end } = bkkDayRange(date);
    const dayEnd = Math.min(end.getTime() - 1, input.now.getTime());
    const ofDay = closes.filter((close) => close.countedAt.getTime() >= start.getTime() && close.countedAt.getTime() <= dayEnd);
    if (ofDay.length > 0) return ofDay.reduce((worst, close) => (STATE_RANK[close.state] > STATE_RANK[worst.state] ? close : worst)).state;
    const lastClose = closes.filter((close) => close.countedAt.getTime() <= dayEnd).at(-1)?.countedAt.getTime() ?? -Infinity;
    const uncounted = cash.some((time) => time > lastClose && time <= dayEnd);
    if (!uncounted) return 'NO_CASH';
    return date === input.today ? 'NOT_COUNTED' : 'MISSED';
  });
}

type PresentedClose = ReturnType<ShopCashCloseService['present']>;
export interface OverviewRow {
  branchId: string; branchName: string; state: CashCloseDayState; close: PresentedClose | null; closeCount: number;
  dayCashIn: number; dayCashOut: number; lastCashInAt: Date | null;
  round: { floatAmount: number; cashIn: number; cashOut: number; expectedAmount: number; periodStart: Date | null } | null;
  canConfirm: boolean;
}

@Injectable()
export class ShopCashOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly closes: ShopCashCloseService,
    private readonly holdings: ShopCashHoldingService,
  ) {}

  /** เจ้าของ/ผจก.การเงิน/บัญชี = ทุกสาขา (หรือสาขาที่เลือก) · ผจก.สาขา = สาขาตัวเองเท่านั้น */
  private async scopeBranches(actor: CashCloseActor, branchId?: string) {
    if (!hasCrossBranchAccess(actor)) {
      if (actor.role !== 'BRANCH_MANAGER' || !actor.branchId || (branchId && branchId !== actor.branchId)) {
        throw new ForbiddenException('ดูสถานะปิดยอดได้เฉพาะสาขาของตัวเอง');
      }
      branchId = actor.branchId;
    }
    return this.prisma.branch.findMany({
      where: { deletedAt: null, ...(branchId ? { id: branchId } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
  }

  /** หน้า "ปิดยอดประจำวัน": ตารางสถานะของวันที่เลือก + แถบ 14 วันล่าสุด + เงินที่ยังไม่ได้นำฝาก */
  async getOverview(actor: CashCloseActor, query: { date?: string; branchId?: string }) {
    const now = new Date();
    const today = bangkokDateString(now);
    const date = query.date || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง');
    const branches = await this.scopeBranches(actor, query.branchId || undefined);
    const branchIds = branches.map((branch) => branch.id);
    const settled = await this.holdings.settledCloseIds(branchIds);
    const stripDates = dateList(today, CASH_CLOSE_STRIP_DAYS);
    const windowStart = bkkDayRange(stripDates[0]).start;
    const day = bkkDayRange(date);

    const rows: OverviewRow[] = [];
    const strip: { branchId: string; branchName: string; cells: CashCloseDayState[] }[] = [];
    for (const branch of branches) {
      // ── แถบ 14 วัน: การปิดยอดที่ยังมีผลตั้งแต่ครั้งสุดท้ายก่อนหน้าต่าง + เวลาเงินสดรับหลังจากนั้น ──
      const boundary = await this.prisma.shopCashClose.findFirst({
        where: { branchId: branch.id, status: { in: EFFECTIVE_CASH_CLOSE_STATUSES }, countedAt: { lt: windowStart } },
        orderBy: { countedAt: 'desc' }, select: { countedAt: true },
      });
      const windowCloses = await this.prisma.shopCashClose.findMany({
        where: { branchId: branch.id, status: { in: EFFECTIVE_CASH_CLOSE_STATUSES }, countedAt: { gte: boundary?.countedAt ?? new Date(0) } },
        include: CLOSE_INCLUDE, orderBy: { countedAt: 'asc' },
      });
      const cashIn = await this.prisma.shopTender.findMany({
        where: { branchId: branch.id, method: 'CASH', direction: 'IN', ...(boundary ? { occurredAt: { gt: boundary.countedAt } } : {}) },
        select: { occurredAt: true }, orderBy: { occurredAt: 'asc' },
      });
      const presented = windowCloses.map((row) => this.closes.present(row, settled));
      const stateInput = presented.map((close) => ({ countedAt: close.countedAt, state: close.moneyState as keyof typeof STATE_RANK }));
      const cashInTimes = cashIn.map((row) => row.occurredAt);
      strip.push({ branchId: branch.id, branchName: branch.name,
        cells: dayStates({ dates: stripDates, today, now, closes: stateInput, cashInTimes }) });

      // ── แถวของวันที่เลือก ──
      const [state] = dayStates({ dates: [date], today, now, closes: stateInput, cashInTimes });
      const ofDay = presented.filter((close) => close.countedAt >= day.start && close.countedAt < day.end);
      const representative = ofDay.reduce<(typeof ofDay)[number] | null>((worst, close) =>
        (!worst || STATE_RANK[close.moneyState as keyof typeof STATE_RANK] >= STATE_RANK[worst.moneyState as keyof typeof STATE_RANK] ? close : worst), null);
      const daySums = await this.prisma.shopTender.groupBy({
        by: ['direction'], where: { branchId: branch.id, method: 'CASH', occurredAt: { gte: day.start, lt: day.end } },
        _sum: { amount: true }, _max: { occurredAt: true },
      });
      const pick = (direction: 'IN' | 'OUT') => daySums.find((row) => row.direction === direction);
      const round = date === today && !representative ? await this.closes.computeRound(this.prisma, branch.id, now) : null;
      rows.push({
        branchId: branch.id, branchName: branch.name, state, close: representative, closeCount: ofDay.length,
        dayCashIn: Number(pick('IN')?._sum.amount ?? 0), dayCashOut: Number(pick('OUT')?._sum.amount ?? 0),
        lastCashInAt: pick('IN')?._max.occurredAt ?? null,
        round: round ? { floatAmount: Number(round.floatAmount), cashIn: Number(round.cashIn), cashOut: Number(round.cashOut),
          expectedAmount: Number(round.expectedAmount), periodStart: round.periodStart } : null,
        canConfirm: !!representative && representative.moneyState === 'AWAITING_CONFIRM'
          && canConfirmBranch(actor, branch.id) && representative.countedBy.id !== actor.id,
      });
    }

    const count = (state: CashCloseDayState) => rows.filter((row) => row.state === state).length;
    return {
      date, today, asOf: now, viewerId: actor.id, viewerRole: actor.role,
      rows,
      summary: { reached: count('REACHED'), atBranch: count('AT_BRANCH'), awaitingConfirm: count('AWAITING_CONFIRM'),
        notCounted: count('NOT_COUNTED') + count('MISSED'), noCash: count('NO_CASH') },
      strip: { dates: stripDates, rows: strip },
      holdings: await this.holdings.getHoldings(actor, branchIds),
    };
  }

  /**
   * แถบเตือนบนหน้าขาย (กระดาน 11 ส่วน C — เจ้าของเคาะ "เตือนอย่างเดียว ยังขายได้"): เมื่อวานสาขามีเงินสดรับ แต่ยังไม่มีการปิดยอดครอบเงินก้อนนั้น.
   * เงื่อนไขเดียวกับแถบเตือนของแท็บประวัติและแดชบอร์ด (`findUnclosedYesterday`) — นับปิดยอดเมื่อไรแถบหายเอง
   */
  async getReminder(actor: CashCloseActor, branchId: string) {
    if (!canViewBranch(actor, branchId)) throw new ForbiddenException('ดูการปิดยอดได้เฉพาะสาขาของตัวเอง');
    const now = new Date();
    const [missed] = await findUnclosedYesterday(this.prisma, now, branchId);
    if (!missed) return { missed: null, canCount: canCountBranch(actor, branchId) };
    const round = await this.closes.computeRound(this.prisma, branchId, now);
    return {
      missed: { branchId, branchName: missed.branchName, date: missed.date, cashIn: missed.cashIn, expectedAmount: Number(round.expectedAmount) },
      canCount: canCountBranch(actor, branchId),
    };
  }
}
