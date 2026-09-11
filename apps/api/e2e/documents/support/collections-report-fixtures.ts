import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import { DocumentsWorld } from './fixtures';
import { createOverdueContract, OverdueContract } from './letters-fixtures';

/**
 * DOC-10 (issue #1569) fixtures — the collections activity behind the analytics
 * report (aging, collectors, dunning recovery, dispatched letters, promises, stuck
 * contracts) and an independent restatement of every figure the PDF prints.
 *
 * The restatements read rows through Prisma and aggregate in JS; they never call
 * the analytics services or copy their SQL. Where the API's window definitions are
 * part of the contract (Bangkok-midnight "since", 7-day recovery window, 14-day
 * stuck threshold, top-N slices) they are restated here explicitly.
 *
 * Time model (verified against production on 2026-09-11): the API process runs in
 * Asia/Bangkok, the database session in UTC — `timestamp` columns hold UTC values and
 * compare against NOW()/bound dates as exact instants; `date_trunc('week'|'month')`
 * and CURRENT_DATE therefore work on the UTC calendar.
 */
export const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Bangkok calendar date (YYYY-MM-DD) of an instant — the report header's date format. */
export function bangkokDate(at: Date): string {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Bangkok midnight of the calendar day `daysAgo` before `now`, as an instant. */
export function bangkokMidnight(daysAgo: number, now = new Date()): Date {
  return new Date(`${bangkokDate(new Date(now.getTime() - daysAgo * DAY_MS))}T00:00:00+07:00`);
}

/** Last millisecond of the Bangkok calendar day `daysAgo` before `now`. */
export function bangkokEndOfDay(daysAgo: number, now = new Date()): Date {
  return new Date(bangkokMidnight(daysAgo - 1, now).getTime() - 1);
}

/** The period every DOC-10 scenario picks: Bangkok calendar days [10 days ago … 3 days ago]. */
export function reportPeriod(now = new Date()): { from: Date; to: Date } {
  return { from: bangkokMidnight(10, now), to: bangkokEndOfDay(3, now) };
}

/** Window the trend sections use for a picked period (the API maps the period length to 30d / 90d). */
export function analyticsRangeFor(from: Date, to: Date): '30d' | '90d' {
  const days = Math.max(7, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return days <= 45 ? '30d' : '90d';
}

/** Start of that window: Bangkok midnight today minus 30 / 90 days. */
export function analyticsSince(range: '30d' | '90d', now = new Date()): Date {
  return bangkokMidnight(range === '30d' ? 30 : 90, now);
}

export type Channel = 'LINE' | 'SMS' | 'CALL_TASK' | 'INTERNAL_ALERT';
export type ActionStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
/** `counted` = the recovery section must count this action for the picked period (executed inside it and SENT/DELIVERED). */
export interface SeededAction { label: string; id: string; contractLabel: string; channel: Channel; status: ActionStatus; executedAt: Date | null; counted: boolean; recovered: boolean }
export interface SeededPromise { label: string; contractLabel: string; callerId: string; calledAt: Date; settlementDate: Date; brokenAt: Date | null }
export interface SeededLetter { label: string; contractLabel: string; letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D'; dispatchedAt: Date }
export interface SeededPayment { label: string; contractLabel: string; installmentNo: number; paidDate: Date; amountPaid: string; status: 'PAID' | 'PARTIALLY_PAID'; recordedById: string }

export interface CollectionsReportSeed {
  now: Date;
  period: { from: Date; to: Date };
  contracts: Record<string, OverdueContract>;
  collectors: { salesA: { id: string; name: string }; branchManagerA: { id: string; name: string } };
  actions: SeededAction[];
  promises: SeededPromise[];
  letters: SeededLetter[];
  payments: SeededPayment[];
  /** Contract labels this world expects in the 14-day stuck list at seed time. */
  stuckLabels: string[];
}

/**
 * One world of collections activity:
 * - overdue contracts in every aging bucket (+ DEFAULT / TERMINATED, and an ACTIVE control)
 * - 30 filler contracts spread over the buckets so the follow-up table exceeds its 20-row slice
 * - dunning actions on and around the picked period's edges, some recovered within 7 days
 * - promises kept / broken / still in the future, dispatched letters in and out of 30 days
 * - installments paid this month by two collectors (leaderboard + collection rate)
 */
export async function seedCollectionsReport(prisma: PrismaService, world: DocumentsWorld, now = new Date()): Promise<CollectionsReportSeed> {
  const period = reportPeriod(now);
  const at = (daysAgo: number, hour = 10, minute = 0): Date => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const collector = async (id: string) => ({ id, name: (await prisma.user.findUniqueOrThrow({ where: { id }, select: { name: true } })).name });
  const salesA = await collector(world.users.salesA.id);
  const branchManagerA = await collector(world.users.branchManagerA.id);
  const contracts: Record<string, OverdueContract> = {};
  const make = async (label: string, oldestOverdueDays: number, extra: { status?: 'ACTIVE' | 'OVERDUE' | 'DEFAULT'; assignedToId?: string; lastContactDaysAgo?: number; terminated?: boolean } = {}) => {
    const contract = await createOverdueContract(prisma, { prefix: world.prefix, label: `CR-${label}`, branchId: world.branches.a.id, customerId: world.customer.id, salespersonId: world.users.salesA.id, oldestOverdueDays, status: extra.status });
    if (extra.assignedToId || extra.lastContactDaysAgo !== undefined || extra.terminated) {
      await prisma.contract.update({ where: { id: contract.id }, data: {
        ...(extra.assignedToId ? { assignedToId: extra.assignedToId } : {}),
        ...(extra.lastContactDaysAgo !== undefined ? { lastContactDate: at(extra.lastContactDaysAgo) } : {}),
        ...(extra.terminated ? { status: 'TERMINATED' } : {}),
      } });
    }
    contracts[label] = contract;
    return contract;
  };

  await make('B1_7', 5, { assignedToId: salesA.id, lastContactDaysAgo: 30 });
  await make('B8_30', 20, { assignedToId: salesA.id });
  await make('B31_60', 50, { assignedToId: branchManagerA.id });
  await make('B61_90', 75);
  await make('B90P', 120, { assignedToId: salesA.id, lastContactDaysAgo: 40 });
  await make('DEFAULT', 200, { status: 'DEFAULT' });
  await make('TERMINATED', 100, { terminated: true });
  await make('ACTIVE', 50, { status: 'ACTIVE' });
  // Fillers: oldest due 11 … 98 days ago (every bucket from 8-30 up), last contact 16 … 45 days ago.
  for (let i = 1; i <= 30; i += 1) {
    await make(`F${String(i).padStart(2, '0')}`, 8 + i * 3, { lastContactDaysAgo: 15 + i });
  }

  // Dunning rules per channel — inactive, so no engine ever schedules them; the actions are seeded directly.
  const rules: Record<Channel, string> = { LINE: '', SMS: '', CALL_TASK: '', INTERNAL_ALERT: '' };
  for (const channel of Object.keys(rules) as Channel[]) {
    const rule = await prisma.dunningRule.create({ data: { name: `${TEST_NAME_PREFIX} ${world.prefix} ${channel}`, channel, messageTemplate: `${TEST_NAME_PREFIX} dunning`, triggerDay: 99, isActive: false, autoExecute: false } });
    rules[channel] = rule.id;
  }
  const mid = new Date(period.from.getTime() + DAY_MS + 10 * 3_600_000);
  const mid2 = new Date(period.from.getTime() + DAY_MS + 12 * 3_600_000);
  // Executed-at instants around the period edges (inclusive on both ends), plus statuses the recovery section ignores.
  // Two actions on F22 share a contract but not a rule: the (rule, contract, payment) key stays unique.
  const actionSpecs: Array<Omit<SeededAction, 'id'>> = [
    { label: 'LINE-AT-FROM', contractLabel: 'B31_60', channel: 'LINE', status: 'SENT', executedAt: period.from, counted: true, recovered: false },
    { label: 'LINE-BEFORE-FROM', contractLabel: 'F17', channel: 'LINE', status: 'SENT', executedAt: new Date(period.from.getTime() - 1000), counted: false, recovered: false },
    { label: 'LINE-AT-TO', contractLabel: 'F18', channel: 'LINE', status: 'SENT', executedAt: period.to, counted: true, recovered: false },
    { label: 'LINE-AFTER-TO', contractLabel: 'F19', channel: 'LINE', status: 'SENT', executedAt: new Date(period.to.getTime() + 1000), counted: false, recovered: false },
    { label: 'LINE-MID-RECOVERED', contractLabel: 'F20', channel: 'LINE', status: 'SENT', executedAt: mid, counted: true, recovered: true },
    { label: 'LINE-MID-LATE-PAYMENT', contractLabel: 'F21', channel: 'LINE', status: 'SENT', executedAt: mid2, counted: true, recovered: false },
    { label: 'SMS-DELIVERED', contractLabel: 'F22', channel: 'SMS', status: 'DELIVERED', executedAt: mid, counted: true, recovered: false },
    { label: 'SMS-FAILED', contractLabel: 'F22', channel: 'INTERNAL_ALERT', status: 'FAILED', executedAt: mid, counted: false, recovered: false },
    { label: 'SMS-PENDING', contractLabel: 'F23', channel: 'SMS', status: 'PENDING', executedAt: null, counted: false, recovered: false },
    { label: 'CALL-RECOVERED', contractLabel: 'F24', channel: 'CALL_TASK', status: 'SENT', executedAt: mid, counted: true, recovered: true },
    { label: 'ALERT', contractLabel: 'F16', channel: 'INTERNAL_ALERT', status: 'SENT', executedAt: mid, counted: true, recovered: false },
  ];
  const actions: SeededAction[] = [];
  for (const spec of actionSpecs) {
    const row = await prisma.dunningAction.create({ data: {
      dunningRuleId: rules[spec.channel], contractId: contracts[spec.contractLabel].id, channel: spec.channel, status: spec.status,
      executedAt: spec.executedAt, createdAt: spec.executedAt ?? mid, messageContent: `${TEST_NAME_PREFIX} ${spec.label}`, executedById: spec.status === 'PENDING' ? null : salesA.id,
    } });
    actions.push({ ...spec, id: row.id });
  }

  const payments: SeededPayment[] = [
    { label: 'RECOVERED-DAY-7', contractLabel: 'F20', installmentNo: 1, paidDate: new Date(mid.getTime() + 7 * DAY_MS), amountPaid: contracts.F20.payments[0].amountDue, status: 'PAID', recordedById: salesA.id },
    { label: 'LATE-DAY-7-PLUS-1H', contractLabel: 'F21', installmentNo: 1, paidDate: new Date(mid2.getTime() + 7 * DAY_MS + 3_600_000), amountPaid: contracts.F21.payments[0].amountDue, status: 'PAID', recordedById: salesA.id },
    { label: 'RECOVERED-DAY-2', contractLabel: 'F24', installmentNo: 1, paidDate: new Date(mid.getTime() + 2 * DAY_MS), amountPaid: contracts.F24.payments[0].amountDue, status: 'PAID', recordedById: branchManagerA.id },
    { label: 'PARTIAL', contractLabel: 'B8_30', installmentNo: 2, paidDate: at(5), amountPaid: '500.00', status: 'PARTIALLY_PAID', recordedById: salesA.id },
  ];
  for (const payment of payments) {
    const row = contracts[payment.contractLabel].payments.find((p) => p.installmentNo === payment.installmentNo)!;
    await prisma.payment.update({ where: { id: row.id }, data: { status: payment.status, amountPaid: payment.amountPaid, paidDate: payment.paidDate, paymentMethod: 'CASH', recordedById: payment.recordedById } });
    row.status = payment.status;
    row.amountPaid = new Prisma.Decimal(payment.amountPaid).toFixed(2);
  }

  const promises: SeededPromise[] = [
    { label: 'KEPT', contractLabel: 'B8_30', callerId: salesA.id, calledAt: at(6), settlementDate: at(4), brokenAt: null },
    { label: 'BROKEN', contractLabel: 'F05', callerId: salesA.id, calledAt: at(12), settlementDate: at(9), brokenAt: at(8) },
    { label: 'KEPT-BM', contractLabel: 'F06', callerId: branchManagerA.id, calledAt: at(20), settlementDate: at(18), brokenAt: null },
    { label: 'FUTURE', contractLabel: 'F07', callerId: salesA.id, calledAt: at(1), settlementDate: at(-3), brokenAt: null },
  ];
  for (const promise of promises) {
    await prisma.callLog.create({ data: {
      contractId: contracts[promise.contractLabel].id, callerId: promise.callerId, calledAt: promise.calledAt, result: 'PROMISED',
      settlementDate: promise.settlementDate, settlementAmount: '1515.83', brokenAt: promise.brokenAt, keptAt: (promise.brokenAt || promise.settlementDate > now) ? null : promise.settlementDate, notes: `${TEST_NAME_PREFIX} ${promise.label}`,
    } });
  }
  // A non-promise call — counts as activity (not stuck), never as a promise.
  await prisma.callLog.create({ data: { contractId: contracts.F08.id, callerId: salesA.id, calledAt: at(2), result: 'ANSWERED', notes: `${TEST_NAME_PREFIX} ANSWERED` } });

  const letters: SeededLetter[] = [
    { label: 'L45-1D', contractLabel: 'F09', letterType: 'RETURN_DEVICE_45D', dispatchedAt: at(1) },
    { label: 'L45-3D', contractLabel: 'F10', letterType: 'RETURN_DEVICE_45D', dispatchedAt: at(3) },
    { label: 'L60-2D', contractLabel: 'F11', letterType: 'CONTRACT_TERMINATION_60D', dispatchedAt: at(2) },
    { label: 'L45-35D', contractLabel: 'F12', letterType: 'RETURN_DEVICE_45D', dispatchedAt: at(35) },
  ];
  for (const letter of letters) {
    await prisma.contractLetter.create({ data: {
      contractId: contracts[letter.contractLabel].id, letterType: letter.letterType, letterNumber: `${TEST_DOC_PREFIX}${world.prefix}-CR-${letter.label}`, status: 'DISPATCHED',
      triggeredAt: new Date(letter.dispatchedAt.getTime() - DAY_MS), pdfGeneratedAt: new Date(letter.dispatchedAt.getTime() - 3_600_000), dispatchedAt: letter.dispatchedAt, dispatchedById: world.users.owner.id, trackingNumber: 'EX000000000TH',
    } });
  }

  const stuckLabels = ['B1_7', 'B61_90', 'B90P', 'DEFAULT', 'TERMINATED', 'F01', 'F02', 'F03', 'F04', 'F06', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F25', 'F26', 'F27', 'F28', 'F29', 'F30'];
  return { now, period, contracts, collectors: { salesA, branchManagerA }, actions, promises, letters, payments, stuckLabels };
}

// ---------------------------------------------------------------------------
// Independent restatements of what the report prints (whole database, same scope as the report).
// ---------------------------------------------------------------------------

const REPORT_CONTRACT_STATUSES = ['OVERDUE', 'DEFAULT', 'TERMINATED'] as const;
const UNPAID_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] as const;
export const AGING_BUCKETS = ['1-7', '8-30', '31-60', '61-90', '90+'] as const;
export const RECOVERY_CHANNELS = ['LINE', 'SMS', 'CALL', 'INTERNAL_ALERT'] as const;

/** Database clock and calendar (the report's SQL uses NOW() / CURRENT_DATE / date_trunc on the session's UTC calendar). */
export async function databaseClock(prisma: PrismaService): Promise<{ now: Date; today: string; monthStart: Date; timezone: string }> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ now: Date; today: string; month_start: Date; tz: string }>>(
    "SELECT NOW() AS now, CURRENT_DATE::text AS today, date_trunc('month', NOW()) AS month_start, current_setting('timezone') AS tz",
  );
  return { now: row.now, today: row.today, monthStart: row.month_start, timezone: row.tz };
}

const money = (value: Prisma.Decimal): string => String(Number(value.toFixed(2)));
const utcDate = (at: Date): string => at.toISOString().slice(0, 10);
const utcMonth = (at: Date): string => at.toISOString().slice(0, 7);
/** Monday of the UTC week holding `at` (date_trunc('week') on a UTC timestamp). */
function utcWeekStart(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return utcDate(day);
}
const daysBetweenDates = (later: string, earlier: string): number => Math.round((new Date(`${later}T00:00:00Z`).getTime() - new Date(`${earlier}T00:00:00Z`).getTime()) / DAY_MS);

export interface AgingRow { bucket: string; count: number; outstanding: string }
/** Aging: contracts OVERDUE/DEFAULT/TERMINATED with unpaid installments due before now, bucketed by the oldest due date (UTC calendar days to today). */
export async function expectedAging(prisma: PrismaService, at: Date): Promise<AgingRow[]> {
  const { today } = await databaseClock(prisma);
  const contracts = await prisma.contract.findMany({ where: { deletedAt: null, status: { in: [...REPORT_CONTRACT_STATUSES] } }, select: { id: true } });
  const payments = await prisma.payment.findMany({ where: { contractId: { in: contracts.map((c) => c.id) }, deletedAt: null, status: { in: [...UNPAID_STATUSES] }, dueDate: { lt: at } }, select: { contractId: true, dueDate: true, amountDue: true, amountPaid: true, lateFee: true } });
  const perContract = new Map<string, { oldest: Date; outstanding: Prisma.Decimal }>();
  for (const p of payments) {
    const entry = perContract.get(p.contractId) ?? { oldest: p.dueDate, outstanding: new Prisma.Decimal(0) };
    if (p.dueDate < entry.oldest) entry.oldest = p.dueDate;
    entry.outstanding = entry.outstanding.plus(p.amountDue).minus(p.amountPaid).plus(p.lateFee);
    perContract.set(p.contractId, entry);
  }
  const rows = new Map<string, { count: number; outstanding: Prisma.Decimal }>(AGING_BUCKETS.map((b) => [b, { count: 0, outstanding: new Prisma.Decimal(0) }]));
  for (const entry of perContract.values()) {
    const days = daysBetweenDates(today, utcDate(entry.oldest));
    const bucket = days >= 1 && days <= 7 ? '1-7' : days <= 30 && days >= 8 ? '8-30' : days <= 60 && days >= 31 ? '31-60' : days <= 90 && days >= 61 ? '61-90' : days > 90 ? '90+' : null;
    if (!bucket) continue;
    const row = rows.get(bucket)!;
    row.count += 1;
    row.outstanding = row.outstanding.plus(entry.outstanding);
  }
  return AGING_BUCKETS.map((bucket) => ({ bucket, count: rows.get(bucket)!.count, outstanding: money(rows.get(bucket)!.outstanding) }));
}

export interface CollectorRow { collectorId: string; name: string; assigned: number; recovery: string; recoveryValue: number }
/** Collectors: users in collector roles with assigned overdue contracts, promises in 90 days, or recovery this month; ordered by recovery desc, assigned desc. */
export async function expectedCollectors(prisma: PrismaService): Promise<CollectorRow[]> {
  const clock = await databaseClock(prisma);
  const users = await prisma.user.findMany({ where: { deletedAt: null, role: { in: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] } }, select: { id: true, name: true } });
  const assigned = await prisma.contract.groupBy({ by: ['assignedToId'], where: { deletedAt: null, assignedToId: { not: null }, status: { in: [...REPORT_CONTRACT_STATUSES] } }, _count: { _all: true } });
  const promises = await prisma.callLog.findMany({ where: { deletedAt: null, result: 'PROMISED', callerId: { not: null }, calledAt: { gte: new Date(clock.now.getTime() - 90 * DAY_MS) }, settlementDate: { not: null, lt: clock.now } }, select: { callerId: true } });
  const recovery = await prisma.payment.findMany({ where: { deletedAt: null, recordedById: { not: null }, paidDate: { gte: clock.monthStart } }, select: { recordedById: true, amountPaid: true } });
  const rows: CollectorRow[] = [];
  for (const user of users) {
    const assignedCount = assigned.find((a) => a.assignedToId === user.id)?._count._all ?? 0;
    const promiseTotal = promises.filter((p) => p.callerId === user.id).length;
    const recovered = recovery.filter((r) => r.recordedById === user.id).reduce((sum, r) => sum.plus(r.amountPaid), new Prisma.Decimal(0));
    if (assignedCount > 0 || promiseTotal > 0 || recovered.gt(0)) rows.push({ collectorId: user.id, name: user.name, assigned: assignedCount, recovery: money(recovered), recoveryValue: Number(recovered.toFixed(2)) });
  }
  return rows.sort((a, b) => b.recoveryValue - a.recoveryValue || b.assigned - a.assigned);
}

export interface RecoveryRow { channel: string; sent: number; recovered: number; rate: string }
/** Recovery by channel: SENT/DELIVERED actions executed inside [from, to] (inclusive), recovered when the contract has a payment dated within 7 days after execution (inclusive). */
export async function expectedRecovery(prisma: PrismaService, from: Date, to: Date): Promise<RecoveryRow[]> {
  const actions = await prisma.dunningAction.findMany({ where: { deletedAt: null, executedAt: { gte: from, lte: to }, status: { in: ['SENT', 'DELIVERED'] } }, select: { id: true, contractId: true, channel: true, executedAt: true } });
  const payments = await prisma.payment.findMany({ where: { contractId: { in: [...new Set(actions.map((a) => a.contractId))] }, deletedAt: null, paidDate: { not: null } }, select: { contractId: true, paidDate: true, amountPaid: true } });
  const totals = new Map<string, { sent: number; recovered: number }>(RECOVERY_CHANNELS.map((c) => [c, { sent: 0, recovered: 0 }]));
  for (const action of actions) {
    const channel = action.channel === 'CALL_TASK' ? 'CALL' : action.channel;
    const row = totals.get(channel);
    if (!row || !action.executedAt) continue;
    const executed = action.executedAt.getTime();
    const recovered = payments.some((p) => p.contractId === action.contractId && p.paidDate!.getTime() >= executed && p.paidDate!.getTime() <= executed + 7 * DAY_MS);
    row.sent += 1;
    if (recovered) row.recovered += 1;
  }
  return RECOVERY_CHANNELS.map((channel) => {
    const row = totals.get(channel)!;
    const rate = row.sent > 0 ? Math.round((row.recovered / row.sent) * 1000) / 10 : 0;
    return { channel, sent: row.sent, recovered: row.recovered, rate: `${rate}%` };
  });
}

export interface StuckRow { contractId: string; contractNumber: string; customerName: string; status: string; lastActivity: number; daysIdle: number }
/** Stuck: OVERDUE/DEFAULT/TERMINATED contracts whose latest call, dunning action or last-contact date is older than `days` (never contacted = epoch); oldest activity first, at most 200. */
export async function expectedStuck(prisma: PrismaService, at: Date, days = 14): Promise<StuckRow[]> {
  const contracts = await prisma.contract.findMany({ where: { deletedAt: null, status: { in: [...REPORT_CONTRACT_STATUSES] } }, select: { id: true, contractNumber: true, status: true, lastContactDate: true, customerId: true } });
  const ids = contracts.map((c) => c.id);
  const calls = await prisma.callLog.groupBy({ by: ['contractId'], where: { contractId: { in: ids }, deletedAt: null }, _max: { calledAt: true } });
  const actions = await prisma.dunningAction.groupBy({ by: ['contractId'], where: { contractId: { in: ids }, deletedAt: null }, _max: { createdAt: true } });
  const customers = await prisma.customer.findMany({ where: { id: { in: [...new Set(contracts.map((c) => c.customerId))] } }, select: { id: true, name: true } });
  const cutoff = at.getTime() - days * DAY_MS;
  const rows: StuckRow[] = [];
  for (const contract of contracts) {
    const lastActivity = Math.max(0, calls.find((c) => c.contractId === contract.id)?._max.calledAt?.getTime() ?? 0, actions.find((a) => a.contractId === contract.id)?._max.createdAt?.getTime() ?? 0, contract.lastContactDate?.getTime() ?? 0);
    if (lastActivity >= cutoff) continue;
    rows.push({ contractId: contract.id, contractNumber: contract.contractNumber, customerName: customers.find((c) => c.id === contract.customerId)?.name ?? '', status: contract.status, lastActivity, daysIdle: Math.floor((at.getTime() - lastActivity) / DAY_MS) });
  }
  return rows.sort((a, b) => a.lastActivity - b.lastActivity || a.contractNumber.localeCompare(b.contractNumber)).slice(0, 200);
}

export interface LetterRow { type: string; month: string; count: number }
/** `letter_type` is a Postgres enum: ORDER BY sorts it in declaration order, not alphabetically. */
const LETTER_TYPE_ORDER = ['RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D'];
/** Letters dispatched since `since`, grouped by type and UTC month, month asc then type in enum order. */
export async function expectedLetters(prisma: PrismaService, since: Date): Promise<LetterRow[]> {
  const letters = await prisma.contractLetter.findMany({ where: { deletedAt: null, dispatchedAt: { gte: since } }, select: { letterType: true, dispatchedAt: true } });
  const counts = new Map<string, LetterRow>();
  for (const letter of letters) {
    const key = `${utcMonth(letter.dispatchedAt!)}|${letter.letterType}`;
    const row = counts.get(key) ?? { type: letter.letterType, month: utcMonth(letter.dispatchedAt!), count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => a.month.localeCompare(b.month) || LETTER_TYPE_ORDER.indexOf(a.type) - LETTER_TYPE_ORDER.indexOf(b.type));
}

export interface PromiseWeekRow { weekStart: string; kept: number; broken: number }
/** Promises per UTC week (Monday) of the broken date, else the settlement date, since `since`; kept = never broken. */
export async function expectedPromiseTrend(prisma: PrismaService, since: Date): Promise<PromiseWeekRow[]> {
  const logs = await prisma.callLog.findMany({ where: { deletedAt: null, result: 'PROMISED', OR: [{ brokenAt: { gte: since } }, { brokenAt: null, settlementDate: { gte: since } }] }, select: { brokenAt: true, settlementDate: true } });
  const weeks = new Map<string, PromiseWeekRow>();
  for (const log of logs) {
    const key = log.brokenAt ?? log.settlementDate;
    if (!key) continue;
    const weekStart = utcWeekStart(key);
    const row = weeks.get(weekStart) ?? { weekStart, kept: 0, broken: 0 };
    if (log.brokenAt) row.broken += 1; else row.kept += 1;
    weeks.set(weekStart, row);
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Dunning actions created since `since`: SENT vs FAILED totals (the KPI strip). */
export async function expectedDunningTotals(prisma: PrismaService, since: Date): Promise<{ sent: number; failed: number }> {
  const actions = await prisma.dunningAction.findMany({ where: { deletedAt: null, createdAt: { gte: since } }, select: { status: true } });
  return { sent: actions.filter((a) => a.status === 'SENT').length, failed: actions.filter((a) => a.status === 'FAILED').length };
}

/** Collection rate: installments with a paid date since `since` — PAID ones over all of them, whole percent. */
export async function expectedCollectionRate(prisma: PrismaService, since: Date): Promise<{ paid: number; due: number; rate: number }> {
  const payments = await prisma.payment.findMany({ where: { deletedAt: null, paidDate: { gte: since } }, select: { status: true } });
  const paid = payments.filter((p) => p.status === 'PAID').length;
  return { paid, due: payments.length, rate: payments.length > 0 ? Math.round((paid / payments.length) * 100) : 0 };
}
