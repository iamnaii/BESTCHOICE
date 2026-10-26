import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import {
  RECURRING_BILL_CATCHUP_DAYS,
  RECURRING_BILL_ERROR,
  RECURRING_BILL_TODO_TAG,
  addCalendarDays,
  bkkCalendarDate,
  calendarDayDiff,
  compareCalendarDate,
  dueDateForPeriod,
  formatCalendarDateTh,
  formatPeriodLabelTh,
  matchWindow,
  nextPeriodKey,
  periodKeyFor,
  prevPeriodKey,
  reminderWindowOpens,
  type CalendarDate,
  type RecurrenceKind,
  type RecurringBillViewStatus,
  type RecurringRule,
} from '@installment/shared';
import { AuditService } from '../../audit/audit.service';
import { getBranchScope } from '../../auth/branch-access.util';
import { bangkokMidnight } from '../../../utils/date.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExpenseTemplatesService } from '../expense-templates.service';
import { isTemplatesEnabled } from '../templates-flag.util';
import { OCCURRENCE_DOCUMENT_SELECT, isExpenseDocumentPaid, isLiveDocument, type OccurrenceDocument } from './recurring-bill-paid.util';
import { viewStatusOf } from './recurring-bill-view.util';
import type { MarkPaidDto } from './dto/mark-paid.dto';
import type { SkipOccurrenceDto } from './dto/skip-occurrence.dto';
import {
  RECURRING_BILL_NOTIFIER,
  RECURRING_BILL_PAGE_PATH,
  type RecurringBillEventKind,
  type RecurringBillNotifier,
} from './recurring-bill-notifier';

/** ผู้กระทำของขั้น A/B — ผู้ใช้ระบบ (cron) หรือผู้กดบันทึกแม่แบบ */
export interface RecurringBillActor {
  id: string;
  branchId: string | null;
  role: string;
}

export interface GenerateResult {
  created: string[];
  skippedMissed: string[];
  skippedExisting: number;
}

export interface SyncResult {
  paid: number;
  reverted: number;
  unpostedClosed: number;
  reminded: number;
  repaired: number;
  failed: number;
}

export interface RunDailyResult extends SyncResult {
  disabled: boolean;
  templates: number;
  created: number;
  skippedMissed: number;
}

export const MISSED_PERIOD_REASON = 'งวดผ่านไปก่อนระบบเริ่มติดตาม';

/** ผู้ใช้ที่เรียก endpoint (จาก @CurrentUser) */
export interface ScopedUser {
  id: string;
  branchId?: string | null;
  role?: string;
}

/** หนึ่งแถวบนหน้า "บิลประจำ" ของเดือน (spec §8) — แถวฉาย (`occurrenceId: null`) คืองวดที่ระบบยังไม่สร้าง */
export interface RecurringBillRow {
  occurrenceId: string | null;
  templateId: string;
  templateName: string;
  vendorName: string | null;
  branch: { id: string; name: string };
  recurrence: RecurrenceKind | null;
  periodKey: string;
  periodLabel: string;
  /** ISO ของเที่ยงคืนไทยวันครบกำหนด */
  dueDate: string;
  daysUntilDue: number;
  daysOverdue: number;
  expectedAmount: string | null;
  status: RecurringBillViewStatus;
  awaitingSystem: boolean;
  documentMissing: boolean;
  templateDeleted: boolean;
  paymentConfigured: boolean;
  document: { id: string; number: string; status: string; totalAmount: string | null; paidAt: string | null } | null;
  todoId: string | null;
  paidAt: string | null;
  paidById: string | null;
  paidByName: string | null;
  paidNote: string | null;
  skipReason: string | null;
  skippedByName: string | null;
}

export interface RecurringBillMonthView {
  month: string;
  summary: {
    upcoming: number;
    pending: number;
    dueToday: number;
    overdue: number;
    paid: number;
    paidUnposted: number;
    skipped: number;
    /** Σ ยอดประมาณของ upcoming+pending+dueToday+overdue (ทศนิยม 2 ตำแหน่ง) */
    amountRemaining: string;
  };
  rows: RecurringBillRow[];
}
export const RULE_CHANGED_REASON = 'แม่แบบเปลี่ยนรอบ';

type TodoView = 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE' | 'UNPOSTED' | 'MISSED';

export interface TemplateRow {
  id: string;
  name: string;
  documentType: string;
  branchId: string;
  isRecurring: boolean;
  recurrence: RecurrenceKind | null;
  recurringDay: number | null;
  recurringMonth: number | null;
  reminderLeadDays: number;
  startsOn: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  prefilledData: unknown;
  branch: { name: string } | null;
}

export interface OccurrenceRow {
  id: string;
  templateId: string;
  periodKey: string;
  dueDate: Date;
  status: string;
  estimatedAmount: unknown;
  expenseDocumentId: string | null;
  todoId: string | null;
  paidAt: Date | null;
  paidById: string | null;
  lastRemindedOn: Date | null;
  template: TemplateRow;
  expenseDocument: OccurrenceDocument | null;
  todo: { id: string; status: string; deletedAt: Date | null } | null;
  paidNote?: string | null;
  skipReason?: string | null;
  skippedById?: string | null;
  paidBy?: { name: string } | null;
  skippedBy?: { name: string } | null;
}

const BKK_OFFSET_MS = 7 * 3600_000;
const SYNC_PAID_LOOKBACK_DAYS = 120;

export function bkkMidnightOf(d: CalendarDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day) - BKK_OFFSET_MS);
}
export function bkkNoonOf(d: CalendarDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 5));
}
/** ค่าสำหรับคอลัมน์ `@db.Date` (Prisma อ่านส่วนวันที่แบบ UTC) */
export function dateOnlyOf(d: CalendarDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export function ruleOf(tpl: Pick<TemplateRow, 'recurrence' | 'recurringDay' | 'recurringMonth'>): RecurringRule | null {
  if (!tpl.recurrence || !tpl.recurringDay) return null;
  return { recurrence: tpl.recurrence, recurringDay: tpl.recurringDay, recurringMonth: tpl.recurringMonth ?? null };
}

function isP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

function estimatedAmountOf(prefilledData: unknown): Prisma.Decimal | null {
  const raw = (prefilledData as { sampleAmount?: unknown } | null)?.sampleAmount;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return new Prisma.Decimal(raw);
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return new Prisma.Decimal(raw.trim());
  }
  return null;
}

function vendorNameOf(prefilledData: unknown): string | null {
  const v = (prefilledData as { vendorName?: unknown } | null)?.vendorName;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function amountText(value: unknown): string {
  if (value == null || value === '') return '—';
  const n = Number(String(value));
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function monthParamOf(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}`;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b;
}

@Injectable()
export class RecurringBillsService {
  private readonly logger = new Logger(RecurringBillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: ExpenseTemplatesService,
    @Inject(RECURRING_BILL_NOTIFIER) private readonly notifier: RecurringBillNotifier,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** ผู้ใช้ระบบ — ห้ามกรอง isActive (seed เป็น false) */
  async findSystemUser(): Promise<RecurringBillActor | null> {
    const u = await this.prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true, branchId: true, role: true },
    });
    return u ? { id: u.id, branchId: u.branchId ?? null, role: 'OWNER' } : null;
  }

  /** รอบตรวจรายวัน (cron 08:05) — ขั้น A ทุกแม่แบบ แล้วขั้น B */
  async runDaily(now: Date = new Date()): Promise<RunDailyResult> {
    const zero: RunDailyResult = {
      disabled: false, templates: 0, created: 0, skippedMissed: 0,
      paid: 0, reverted: 0, unpostedClosed: 0, reminded: 0, repaired: 0, failed: 0,
    };
    if (!(await isTemplatesEnabled(this.prisma))) {
      this.logger.log('[recurring-bills] templates_enabled=false — ข้ามทั้งรอบ');
      return { ...zero, disabled: true };
    }
    const actor = await this.findSystemUser();
    if (!actor) {
      const msg = '[RecurringBills] ไม่พบผู้ใช้ระบบ (isSystemUser) — ข้ามรอบ';
      this.logger.error(msg);
      Sentry.captureMessage(msg, { level: 'error', tags: { cron: 'recurring-bills' } });
      return zero;
    }
    const templates = await this.prisma.expenseTemplate.findMany({
      where: { isRecurring: true, recurrence: { not: null }, documentType: 'EXPENSE', deletedAt: null },
      select: { id: true },
    });
    const result = { ...zero, templates: templates.length };
    for (const tpl of templates) {
      try {
        const r = await this.generateForTemplate(tpl.id, now, actor);
        result.created += r.created.length;
        result.skippedMissed += r.skippedMissed.length;
      } catch (err) {
        result.failed++;
        Sentry.captureException(err, { tags: { cron: 'recurring-bills', stage: 'generate' }, extra: { templateId: tpl.id } });
        this.logger.error(`[recurring-bills] generate failed for ${tpl.id}: ${(err as Error).message}`);
      }
    }
    const sync = await this.syncOccurrences(now, actor);
    result.paid = sync.paid;
    result.reverted = sync.reverted;
    result.unpostedClosed = sync.unpostedClosed;
    result.reminded = sync.reminded;
    result.repaired = sync.repaired;
    result.failed += sync.failed;
    this.logger.log(
      `[recurring-bills] templates=${result.templates} created=${result.created} missed=${result.skippedMissed} paid=${result.paid} reverted=${result.reverted} unpostedClosed=${result.unpostedClosed} reminded=${result.reminded} repaired=${result.repaired} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * ขั้น A — สร้างงวดที่ถึงหน้าต่างเตือนของแม่แบบหนึ่งใบ (สเปก §7 + §15.3/§15.5)
   * `actor` ว่าง = หาผู้ใช้ระบบ (ไม่มี = throw)
   */
  async generateForTemplate(templateId: string, now: Date = new Date(), actor?: RecurringBillActor): Promise<GenerateResult> {
    const result: GenerateResult = { created: [], skippedMissed: [], skippedExisting: 0 };
    const who = actor ?? (await this.findSystemUser());
    if (!who) throw new Error('ไม่พบผู้ใช้ระบบ (isSystemUser) — สร้างงวดบิลประจำไม่ได้');
    const tpl = (await this.prisma.expenseTemplate.findUnique({
      where: { id: templateId },
      include: { branch: { select: { name: true } } },
    })) as TemplateRow | null;
    const rule = tpl ? ruleOf(tpl) : null;
    if (!tpl || tpl.deletedAt || !tpl.isRecurring || !rule || tpl.documentType !== 'EXPENSE') return result;

    const today = bkkCalendarDate(now);
    const startsOn = bkkCalendarDate(tpl.startsOn ?? tpl.createdAt);
    const floor = addCalendarDays(today, -RECURRING_BILL_CATCHUP_DAYS);
    const scanFrom = compareCalendarDate(startsOn, floor) > 0 ? startsOn : floor;
    const lead = Math.max(0, tpl.reminderLeadDays ?? 3);
    const existing = new Set(
      (await this.prisma.recurringBillOccurrence.findMany({ where: { templateId: tpl.id }, select: { periodKey: true } })).map(
        (r) => r.periodKey,
      ),
    );

    let key = prevPeriodKey(rule, periodKeyFor(rule, scanFrom));
    for (let guard = 0; guard < 60; guard++, key = nextPeriodKey(rule, key)) {
      const due = dueDateForPeriod(rule, key);
      if (compareCalendarDate(reminderWindowOpens(rule, key, lead), today) > 0) break;
      if (compareCalendarDate(due, startsOn) < 0) continue;
      if (existing.has(key)) continue;

      const missed = compareCalendarDate(due, floor) < 0;
      const diff = calendarDayDiff(due, today);
      const view: TodoView = missed ? 'MISSED' : diff > 0 ? 'OVERDUE' : diff === 0 ? 'DUE_TODAY' : 'UPCOMING';
      let occId: string;
      try {
        const occ = await this.prisma.recurringBillOccurrence.create({
          data: {
            templateId: tpl.id,
            periodKey: key,
            dueDate: bkkMidnightOf(due),
            status: missed ? 'SKIPPED' : 'PENDING',
            estimatedAmount: estimatedAmountOf(tpl.prefilledData),
            ...(missed ? { skippedAt: now, skippedById: null, skipReason: MISSED_PERIOD_REASON } : {}),
            ...(!missed && view !== 'UPCOMING' ? { lastRemindedOn: dateOnlyOf(today) } : {}),
          },
        });
        occId = occ.id;
      } catch (err) {
        if (isP2002(err)) {
          result.skippedExisting++;
          continue;
        }
        throw err;
      }

      if (missed) {
        await this.createTodo({ occId, tpl, due, view: 'MISSED', daysOverdue: diff, actorId: who.id, docNumber: null, draftFailed: false });
        result.skippedMissed.push(key);
        continue;
      }

      let docNumber: string | null = null;
      let draftFailed = false;
      try {
        docNumber = (await this.ensureDraft(tpl, occId, due, who))?.number ?? null;
      } catch (err) {
        draftFailed = true;
        Sentry.captureException(err, { tags: { cron: 'recurring-bills', stage: 'draft' }, extra: { templateId: tpl.id, periodKey: key } });
        this.logger.error(`[recurring-bills] draft failed for ${tpl.id}/${key}: ${(err as Error).message}`);
      }
      await this.createTodo({ occId, tpl, due, view, daysOverdue: diff, actorId: who.id, docNumber, draftFailed });
      await this.safeNotify(view as RecurringBillEventKind, { occId, tpl, due, daysOverdue: diff, docNumber });
      result.created.push(key);
    }
    return result;
  }

  /** ②③ — ร่างของงวด: ใช้ร่างของผู้กระทำที่ลงวันครบกำหนดอยู่แล้ว (รอบก่อนผูกไม่สำเร็จ) ไม่งั้น instantiate */
  private async ensureDraft(tpl: TemplateRow, occId: string, due: CalendarDate, who: RecurringBillActor) {
    const dayStart = bkkMidnightOf(due);
    const dayEnd = bkkMidnightOf(addCalendarDays(due, 1));
    const existing = await this.prisma.expenseDocument.findFirst({
      where: {
        fromTemplateId: tpl.id,
        createdById: who.id,
        recurringBillOccurrence: null,
        deletedAt: null,
        status: { not: 'VOIDED' },
        documentDate: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, number: true },
    });
    const doc = existing ?? (await this.templates.instantiate(tpl.id, who, { documentDate: bkkNoonOf(due) }));
    await this.prisma.recurringBillOccurrence.update({ where: { id: occId }, data: { expenseDocumentId: doc.id } });
    return doc as { id: string; number: string };
  }

  /** ขั้น B — อัปเดตงวด PENDING ทุกแถว + งวด PAID ที่ยังต้องดูแล (120 วันหลังสุด) */
  async syncOccurrences(now: Date = new Date(), actor?: RecurringBillActor): Promise<SyncResult> {
    const result: SyncResult = { paid: 0, reverted: 0, unpostedClosed: 0, reminded: 0, repaired: 0, failed: 0 };
    const who = actor ?? (await this.findSystemUser());
    if (!who) return result;
    const today = bkkCalendarDate(now);
    const cutoff = new Date(now.getTime() - SYNC_PAID_LOOKBACK_DAYS * 86_400_000);
    const rows = (await this.prisma.recurringBillOccurrence.findMany({
      where: { OR: [{ status: 'PENDING' }, { status: 'PAID', dueDate: { gte: cutoff } }] },
      include: {
        template: { include: { branch: { select: { name: true } } } },
        expenseDocument: { select: OCCURRENCE_DOCUMENT_SELECT },
        todo: { select: { id: true, status: true, deletedAt: true } },
      },
      orderBy: { dueDate: 'asc' },
    })) as unknown as OccurrenceRow[];

    for (const row of rows) {
      try {
        if (row.status === 'PENDING') await this.syncPending(row, today, now, who, result);
        else if (row.status === 'PAID' && row.paidById == null) await this.syncSystemPaid(row, today, now, result);
        else if (row.status === 'PAID') await this.syncManualPaid(row, today, now, who, result);
      } catch (err) {
        result.failed++;
        Sentry.captureException(err, { tags: { cron: 'recurring-bills', stage: 'sync' }, extra: { occurrenceId: row.id } });
        this.logger.error(`[recurring-bills] sync failed for ${row.id}: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async syncPending(row: OccurrenceRow, today: CalendarDate, now: Date, who: RecurringBillActor, result: SyncResult) {
    const tpl = row.template;
    const rule = ruleOf(tpl);
    const due = bkkCalendarDate(row.dueDate);
    const linked = row.expenseDocument;
    const paidDoc = isExpenseDocumentPaid(linked) ? linked : rule ? await this.findOtherPaidDocument(row, rule, tpl.reminderLeadDays ?? 3) : null;
    if (paidDoc) {
      const res = await this.prisma.recurringBillOccurrence.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'PAID', paidAt: minDate(paidDoc.paidAt as Date, now), paidById: null, expenseDocumentId: paidDoc.id },
      });
      if (res.count === 1) {
        if (linked && linked.id !== paidDoc.id && linked.status === 'DRAFT' && !linked.deletedAt) {
          await this.retireDraft(linked, who, `งวดบิลประจำจ่ายผ่านใบ ${paidDoc.number} แล้ว — ลบร่างที่ระบบสร้าง`, now);
        }
        if (row.todoId) await this.closeTodo(row.todoId, now);
        result.paid++;
      }
      return;
    }

    const diff = calendarDayDiff(due, today);
    if (!row.todoId) {
      const view: TodoView = diff > 0 ? 'OVERDUE' : diff === 0 ? 'DUE_TODAY' : 'UPCOMING';
      const created = await this.repairTodo(row, view, diff, who.id);
      if (created) {
        result.repaired++;
        await this.safeNotify('UPCOMING', { occId: row.id, tpl, due, daysOverdue: diff, docNumber: linked?.number ?? null });
      }
    }
    if (diff < 0) return;

    const todayDate = dateOnlyOf(today);
    const res = await this.prisma.recurringBillOccurrence.updateMany({
      where: { id: row.id, status: 'PENDING', OR: [{ lastRemindedOn: null }, { lastRemindedOn: { lt: todayDate } }] },
      data: { lastRemindedOn: todayDate },
    });
    if (res.count !== 1) return;
    const view: TodoView = diff === 0 ? 'DUE_TODAY' : 'OVERDUE';
    if (row.todoId && row.todo && !row.todo.deletedAt) {
      await this.prisma.todo.updateMany({
        where: { id: row.todoId, deletedAt: null, status: { not: 'DONE' } },
        data: { title: this.todoTitle(tpl, due, view, diff, linked?.number ?? null), priority: 'HIGH' },
      });
    }
    await this.safeNotify(view as RecurringBillEventKind, { occId: row.id, tpl, due, daysOverdue: diff, docNumber: linked?.number ?? null });
    result.reminded++;
  }

  /** งวดที่ระบบตั้ง PAID จากใบ — ใบถูก void/ลบ → ถอยกลับ PENDING (สเปก §7 ข้อ 5) */
  private async syncSystemPaid(row: OccurrenceRow, today: CalendarDate, now: Date, result: SyncResult) {
    if (isExpenseDocumentPaid(row.expenseDocument)) return;
    const res = await this.prisma.recurringBillOccurrence.updateMany({
      where: { id: row.id, status: 'PAID', paidById: null },
      data: { status: 'PENDING', paidAt: null },
    });
    if (res.count !== 1) return;
    const due = bkkCalendarDate(row.dueDate);
    const diff = calendarDayDiff(due, today);
    const view: TodoView = diff > 0 ? 'OVERDUE' : diff === 0 ? 'DUE_TODAY' : 'UPCOMING';
    if (row.todoId) {
      await this.prisma.todo.updateMany({
        where: { id: row.todoId, deletedAt: null },
        data: {
          status: 'TODO',
          completedAt: null,
          title: this.todoTitle(row.template, due, view, diff, row.expenseDocument?.number ?? null),
          priority: diff >= 0 ? 'HIGH' : 'MEDIUM',
        },
      });
    }
    result.reverted++;
  }

  /** งวดที่คนบันทึกเองว่าจ่ายแล้ว — งานเปลี่ยนเป็น "ลงบัญชีใบ …" จนใบผ่าน (สเปก §7 ข้อ 6) */
  private async syncManualPaid(row: OccurrenceRow, today: CalendarDate, now: Date, who: RecurringBillActor, result: SyncResult) {
    const due = bkkCalendarDate(row.dueDate);
    const diff = calendarDayDiff(due, today);
    if (isExpenseDocumentPaid(row.expenseDocument)) {
      if (row.todoId && row.todo && !row.todo.deletedAt && row.todo.status !== 'DONE') {
        await this.closeTodo(row.todoId, now);
        result.unpostedClosed++;
      }
      return;
    }
    const docNumber = row.expenseDocument && !row.expenseDocument.deletedAt && row.expenseDocument.status !== 'VOIDED' ? row.expenseDocument.number : null;
    if (!row.todoId) {
      if (await this.repairTodo(row, 'UNPOSTED', diff, who.id)) result.repaired++;
      return;
    }
    if (row.todo && !row.todo.deletedAt && row.todo.status !== 'DONE') {
      await this.prisma.todo.updateMany({
        where: { id: row.todoId, deletedAt: null, status: { not: 'DONE' } },
        data: { title: this.todoTitle(row.template, due, 'UNPOSTED', diff, docNumber), priority: diff >= 0 ? 'HIGH' : 'MEDIUM' },
      });
    }
  }

  /** ใบอื่นจากแม่แบบเดียวกัน ที่ยังไม่ถูกผูกงวดใด จ่ายแล้ว และลงวันที่ในหน้าต่างของงวดนี้ (สเปก §15.3) */
  private async findOtherPaidDocument(row: OccurrenceRow, rule: RecurringRule, leadDays: number): Promise<OccurrenceDocument | null> {
    const w = matchWindow(rule, row.periodKey, Math.max(0, leadDays));
    return (await this.prisma.expenseDocument.findFirst({
      where: {
        fromTemplateId: row.templateId,
        recurringBillOccurrence: null,
        deletedAt: null,
        status: 'POSTED',
        paidAt: { not: null },
        documentDate: { gte: bkkMidnightOf(w.from), lt: bkkMidnightOf(w.to) },
      },
      orderBy: { documentDate: 'asc' },
      select: OCCURRENCE_DOCUMENT_SELECT,
    })) as OccurrenceDocument | null;
  }

  /**
   * แม่แบบเปลี่ยนรอบ (spec §15.5): งวด PENDING ที่ใบยังไม่จ่าย → SKIPPED ระบบ + ปิดงาน + ลบร่างที่ยัง DRAFT
   * งวดที่ใบจ่ายแล้วปล่อยไว้ให้ขั้น B ปิดตามปกติ
   */
  async retireOpenOccurrences(templateId: string, reason: string, actor: RecurringBillActor, now: Date = new Date()): Promise<{ retired: number }> {
    const rows = (await this.prisma.recurringBillOccurrence.findMany({
      where: { templateId, status: 'PENDING' },
      include: {
        expenseDocument: { select: OCCURRENCE_DOCUMENT_SELECT },
        todo: { select: { id: true, status: true, deletedAt: true } },
      },
    })) as unknown as Array<Pick<OccurrenceRow, 'id' | 'todoId' | 'expenseDocument' | 'todo'>>;
    let retired = 0;
    for (const row of rows) {
      if (isExpenseDocumentPaid(row.expenseDocument)) continue;
      const res = await this.prisma.recurringBillOccurrence.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'SKIPPED', skippedAt: now, skippedById: null, skipReason: reason },
      });
      if (res.count !== 1) continue;
      if (row.todoId) await this.closeTodo(row.todoId, now);
      if (row.expenseDocument && row.expenseDocument.status === 'DRAFT' && !row.expenseDocument.deletedAt) {
        await this.retireDraft(row.expenseDocument, actor, `${reason} — ลบร่างที่ระบบสร้างให้งวดเดิม`, now);
      }
      retired++;
    }
    return { retired };
  }

  /** ร่างระบบของงวดที่ถูกแทน/ยกเลิก — ลบ (soft) ใน tx เดียวกับ audit ตรง (ไม่ผ่าน lifecycle ที่ต้องการสิทธิ์) */
  private async retireDraft(draft: OccurrenceDocument, who: RecurringBillActor, reason: string, now: Date) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.expenseDocument.updateMany({
        where: { id: draft.id, status: 'DRAFT', deletedAt: null },
        data: { deletedAt: now },
      });
      if (res.count !== 1) return;
      await tx.auditLog.create({
        data: {
          action: 'DELETED',
          entity: 'expense_document',
          entityId: draft.id,
          userId: who.id,
          oldValue: { status: 'DRAFT' },
          newValue: { deletedAt: now, reason },
        },
      });
    });
  }

  // ─── มุมมองรายเดือน (spec §8) ─────────────────────────────────────────────────

  private resolveBranch(user: ScopedUser, requested?: string): string | undefined {
    const scope = getBranchScope(user);
    if (scope.all) return requested || undefined;
    if (!scope.branchId) throw new ForbiddenException('ผู้ใช้งานยังไม่ได้ผูกกับสาขา ไม่สามารถดูบิลประจำได้');
    return scope.branchId; // BM/SALES: ล็อกสาขาตัวเอง ไม่สนใจ query
  }

  private assertScope(user: ScopedUser, branchId: string): void {
    const scope = getBranchScope(user);
    if (!scope.all && scope.branchId !== branchId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงบิลของสาขาอื่น');
    }
  }

  async listMonth(user: ScopedUser, month: string, branchId?: string, now: Date = new Date()): Promise<RecurringBillMonthView> {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    const year = m ? Number(m[1]) : 0;
    const mon = m ? Number(m[2]) : 0;
    if (!m || mon < 1 || mon > 12) throw new BadRequestException('เดือนต้องเป็นรูปแบบ YYYY-MM');
    const effectiveBranch = this.resolveBranch(user, branchId);
    const today = bkkCalendarDate(now);
    const monthStart = bangkokMidnight(year, mon - 1, 1);
    const monthEnd = bangkokMidnight(year, mon, 1);
    const firstOfNext: CalendarDate = bkkCalendarDate(monthEnd);

    const rows = (await this.prisma.recurringBillOccurrence.findMany({
      where: {
        dueDate: { gte: monthStart, lt: monthEnd },
        ...(effectiveBranch ? { template: { branchId: effectiveBranch } } : {}),
      },
      include: {
        template: { include: { branch: { select: { id: true, name: true } } } },
        expenseDocument: { select: OCCURRENCE_DOCUMENT_SELECT },
        todo: { select: { id: true, status: true, deletedAt: true } },
        paidBy: { select: { name: true } },
        skippedBy: { select: { name: true } },
      },
      orderBy: { dueDate: 'asc' },
    })) as unknown as OccurrenceRow[];

    const liveTemplates = (await this.prisma.expenseTemplate.findMany({
      where: {
        isRecurring: true,
        recurrence: { not: null },
        documentType: 'EXPENSE',
        deletedAt: null,
        ...(effectiveBranch ? { branchId: effectiveBranch } : {}),
      },
      include: { branch: { select: { id: true, name: true } } },
    })) as unknown as TemplateRow[];

    const existing = new Set(rows.map((r) => `${r.templateId}|${r.periodKey}`));
    const out: RecurringBillRow[] = rows.map((r) => this.toRow(r, today));
    for (const tpl of liveTemplates) {
      const rule = ruleOf(tpl);
      if (!rule) continue;
      const startsOn = bkkCalendarDate(tpl.startsOn ?? tpl.createdAt);
      const lead = Math.max(0, tpl.reminderLeadDays ?? 3);
      let key = periodKeyFor(rule, { year, month: mon, day: 1 });
      for (let guard = 0; guard < 3; guard++, key = nextPeriodKey(rule, key)) {
        const due = dueDateForPeriod(rule, key);
        if (compareCalendarDate(due, firstOfNext) >= 0) break;
        if (due.year !== year || due.month !== mon) continue;
        if (existing.has(`${tpl.id}|${key}`)) continue;
        if (compareCalendarDate(due, startsOn) < 0) continue;
        if (compareCalendarDate(due, today) < 0) continue; // งวดที่ผ่านไปแล้วและไม่มีแถว — ไม่ฉาย (§15.2)
        const awaitingSystem = compareCalendarDate(reminderWindowOpens(rule, key, lead), today) <= 0;
        out.push(this.projectedRow(tpl, rule, key, due, today, awaitingSystem));
      }
    }
    out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.templateName.localeCompare(b.templateName, 'th'));

    const summary = { upcoming: 0, pending: 0, dueToday: 0, overdue: 0, paid: 0, paidUnposted: 0, skipped: 0, amountRemaining: '0.00' };
    let remaining = new Prisma.Decimal(0);
    for (const r of out) {
      const bucket = (
        { UPCOMING: 'upcoming', PENDING: 'pending', DUE_TODAY: 'dueToday', OVERDUE: 'overdue', PAID: 'paid', PAID_UNPOSTED: 'paidUnposted', SKIPPED: 'skipped' } as const
      )[r.status];
      summary[bucket]++;
      if (['UPCOMING', 'PENDING', 'DUE_TODAY', 'OVERDUE'].includes(r.status) && r.expectedAmount != null) {
        remaining = remaining.plus(new Prisma.Decimal(r.expectedAmount));
      }
    }
    summary.amountRemaining = remaining.toFixed(2);
    return { month, summary, rows: out };
  }

  private toRow(r: OccurrenceRow, today: CalendarDate): RecurringBillRow {
    const tpl = r.template;
    const rule = ruleOf(tpl);
    const doc = r.expenseDocument;
    const due = bkkCalendarDate(r.dueDate);
    const diff = calendarDayDiff(due, today);
    const pf = (tpl.prefilledData ?? {}) as Record<string, unknown>;
    const live = isLiveDocument(doc);
    return {
      occurrenceId: r.id,
      templateId: tpl.id,
      templateName: tpl.name,
      vendorName: vendorNameOf(tpl.prefilledData),
      branch: { id: tpl.branchId, name: tpl.branch?.name ?? '' },
      recurrence: tpl.recurrence,
      periodKey: r.periodKey,
      periodLabel: rule ? formatPeriodLabelTh(rule, r.periodKey) : r.periodKey,
      dueDate: r.dueDate.toISOString(),
      daysUntilDue: Math.max(0, -diff),
      daysOverdue: Math.max(0, diff),
      expectedAmount: r.estimatedAmount == null ? null : String(r.estimatedAmount),
      status: viewStatusOf(r, doc, today),
      awaitingSystem: false,
      documentMissing: !live,
      templateDeleted: !!tpl.deletedAt,
      paymentConfigured: !!(pf.paymentMethod && pf.depositAccountCode),
      document: live && doc
        ? { id: doc.id, number: doc.number, status: doc.status, totalAmount: doc.totalAmount == null ? null : String(doc.totalAmount), paidAt: doc.paidAt ? doc.paidAt.toISOString() : null }
        : null,
      todoId: r.todoId,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      paidById: r.paidById,
      paidByName: r.paidBy?.name ?? null,
      paidNote: r.paidNote ?? null,
      skipReason: r.skipReason ?? null,
      skippedByName: r.skippedBy?.name ?? null,
    };
  }

  private projectedRow(tpl: TemplateRow, rule: RecurringRule, key: string, due: CalendarDate, today: CalendarDate, awaitingSystem: boolean): RecurringBillRow {
    const pf = (tpl.prefilledData ?? {}) as Record<string, unknown>;
    const amount = estimatedAmountOf(tpl.prefilledData);
    const diff = calendarDayDiff(due, today);
    return {
      occurrenceId: null,
      templateId: tpl.id,
      templateName: tpl.name,
      vendorName: vendorNameOf(tpl.prefilledData),
      branch: { id: tpl.branchId, name: tpl.branch?.name ?? '' },
      recurrence: tpl.recurrence,
      periodKey: key,
      periodLabel: formatPeriodLabelTh(rule, key),
      dueDate: bkkMidnightOf(due).toISOString(),
      daysUntilDue: Math.max(0, -diff),
      daysOverdue: 0,
      expectedAmount: amount ? amount.toString() : null,
      status: 'UPCOMING',
      awaitingSystem,
      documentMissing: true,
      templateDeleted: false,
      paymentConfigured: !!(pf.paymentMethod && pf.depositAccountCode),
      document: null,
      todoId: null,
      paidAt: null,
      paidById: null,
      paidByName: null,
      paidNote: null,
      skipReason: null,
      skippedByName: null,
    };
  }

  // ─── การกระทำบนงวด (spec §8 + §15.5) — ทุก transition เป็น CAS ────────────────

  private async loadOccurrence(id: string): Promise<OccurrenceRow> {
    const occ = (await this.prisma.recurringBillOccurrence.findUnique({
      where: { id },
      include: {
        template: { include: { branch: { select: { id: true, name: true } } } },
        expenseDocument: { select: OCCURRENCE_DOCUMENT_SELECT },
        todo: { select: { id: true, status: true, deletedAt: true } },
      },
    })) as unknown as OccurrenceRow | null;
    if (!occ) throw new NotFoundException('ไม่พบงวดบิลประจำ');
    return occ;
  }

  private async logAudit(user: ScopedUser, action: string, occ: OccurrenceRow, newValue: Record<string, unknown>) {
    if (!this.audit) return;
    await this.audit.log({
      userId: user.id,
      action,
      entity: 'recurring_bill_occurrence',
      entityId: occ.id,
      newValue: { templateId: occ.templateId, periodKey: occ.periodKey, ...newValue },
    });
  }

  async markPaid(id: string, user: ScopedUser, dto: MarkPaidDto, now: Date = new Date()) {
    const occ = await this.loadOccurrence(id);
    this.assertScope(user, occ.template.branchId);
    if (occ.status !== 'PENDING') throw new ConflictException(RECURRING_BILL_ERROR.NOT_PENDING);
    let paidAt = now;
    if (dto.paidAt) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dto.paidAt);
      if (!m) throw new BadRequestException('วันที่จ่ายต้องเป็นรูปแบบ YYYY-MM-DD');
      paidAt = bangkokMidnight(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (paidAt.getTime() > now.getTime()) throw new BadRequestException('วันที่จ่ายต้องไม่เกินวันนี้');
    }
    const note = dto.note?.trim() || null;
    const res = await this.prisma.recurringBillOccurrence.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'PAID', paidAt, paidById: user.id, paidNote: note },
    });
    if (res.count !== 1) throw new ConflictException(RECURRING_BILL_ERROR.STATE_CHANGED);
    const due = bkkCalendarDate(occ.dueDate);
    const diff = calendarDayDiff(due, bkkCalendarDate(now));
    const docNumber = isLiveDocument(occ.expenseDocument) ? occ.expenseDocument!.number : null;
    if (occ.todoId && occ.todo && !occ.todo.deletedAt) {
      await this.prisma.todo.updateMany({
        where: { id: occ.todoId, deletedAt: null, status: { not: 'DONE' } },
        data: { title: this.todoTitle(occ.template, due, 'UNPOSTED', diff, docNumber), priority: diff >= 0 ? 'HIGH' : 'MEDIUM' },
      });
    } else if (!occ.todoId) {
      await this.repairTodo({ ...occ, status: 'PAID', paidById: user.id }, 'UNPOSTED', diff, user.id);
    }
    await this.logAudit(user, 'RECURRING_BILL_MARKED_PAID', occ, { paidAt, note, documentNumber: docNumber });
    return { ...occ, status: 'PAID', paidAt, paidById: user.id, paidNote: note };
  }

  async skip(id: string, user: ScopedUser, dto: SkipOccurrenceDto, now: Date = new Date()) {
    const occ = await this.loadOccurrence(id);
    this.assertScope(user, occ.template.branchId);
    if (occ.status !== 'PENDING') throw new ConflictException(RECURRING_BILL_ERROR.NOT_PENDING);
    const reason = dto.reason.trim();
    const res = await this.prisma.recurringBillOccurrence.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SKIPPED', skippedAt: now, skippedById: user.id, skipReason: reason },
    });
    if (res.count !== 1) throw new ConflictException(RECURRING_BILL_ERROR.STATE_CHANGED);
    if (occ.todoId) await this.closeTodo(occ.todoId, now);
    if (occ.expenseDocument && occ.expenseDocument.status === 'DRAFT' && !occ.expenseDocument.deletedAt) {
      await this.retireDraft(occ.expenseDocument, { id: user.id, branchId: user.branchId ?? null, role: user.role ?? '' }, `ข้ามงวดบิลประจำ: ${reason} — ลบร่างที่ระบบสร้าง`, now);
    }
    await this.logAudit(user, 'RECURRING_BILL_SKIPPED', occ, { reason });
    return { ...occ, status: 'SKIPPED', skippedAt: now, skippedById: user.id, skipReason: reason };
  }

  async reopen(id: string, user: ScopedUser, now: Date = new Date()) {
    const occ = await this.loadOccurrence(id);
    this.assertScope(user, occ.template.branchId);
    if (occ.status === 'PENDING') throw new ConflictException('งวดนี้อยู่ในสถานะรอจ่ายอยู่แล้ว');
    if (occ.status === 'PAID' && occ.paidById == null) {
      throw new ConflictException(RECURRING_BILL_ERROR.PAID_BY_DOCUMENT(occ.expenseDocument?.number ?? '—'));
    }
    const res = await this.prisma.recurringBillOccurrence.updateMany({
      where: { id, status: occ.status as never },
      data: { status: 'PENDING', paidAt: null, paidById: null, paidNote: null, skippedAt: null, skippedById: null, skipReason: null },
    });
    if (res.count !== 1) throw new ConflictException(RECURRING_BILL_ERROR.STATE_CHANGED);
    const due = bkkCalendarDate(occ.dueDate);
    const diff = calendarDayDiff(due, bkkCalendarDate(now));
    const view: TodoView = diff > 0 ? 'OVERDUE' : diff === 0 ? 'DUE_TODAY' : 'UPCOMING';
    const actor: RecurringBillActor = { id: user.id, branchId: user.branchId ?? null, role: user.role ?? '' };
    let docNumber = isLiveDocument(occ.expenseDocument) ? occ.expenseDocument!.number : null;
    if (!docNumber && !occ.template.deletedAt) {
      try {
        docNumber = (await this.ensureDraft(occ.template, occ.id, due, actor)).number;
      } catch (err) {
        Sentry.captureException(err, { tags: { cron: 'recurring-bills', stage: 'reopen-draft' }, extra: { occurrenceId: id } });
      }
    }
    if (occ.todoId && occ.todo && !occ.todo.deletedAt) {
      await this.prisma.todo.updateMany({
        where: { id: occ.todoId, deletedAt: null },
        data: { status: 'TODO', completedAt: null, title: this.todoTitle(occ.template, due, view, diff, docNumber), priority: diff >= 0 ? 'HIGH' : 'MEDIUM' },
      });
    } else if (!occ.todoId) {
      await this.repairTodo({ ...occ, status: 'PENDING', expenseDocument: docNumber ? { ...(occ.expenseDocument ?? ({} as OccurrenceDocument)), number: docNumber, status: 'DRAFT', deletedAt: null } : occ.expenseDocument }, view, diff, user.id);
    }
    await this.logAudit(user, 'RECURRING_BILL_REOPENED', occ, { from: occ.status, documentNumber: docNumber });
    return { ...occ, status: 'PENDING', paidAt: null, paidById: null, paidNote: null, skippedAt: null, skippedById: null, skipReason: null };
  }

  async createDraft(id: string, user: ScopedUser, now: Date = new Date()) {
    const occ = await this.loadOccurrence(id);
    this.assertScope(user, occ.template.branchId);
    if (isLiveDocument(occ.expenseDocument)) throw new ConflictException(RECURRING_BILL_ERROR.DRAFT_EXISTS);
    if (occ.template.deletedAt) throw new ConflictException(RECURRING_BILL_ERROR.TEMPLATE_DELETED);
    if (occ.status === 'SKIPPED') throw new ConflictException('งวดที่ข้ามแล้ว ให้กด "เปิดใหม่" ก่อนสร้างร่าง');
    const due = bkkCalendarDate(occ.dueDate);
    const actor: RecurringBillActor = { id: user.id, branchId: user.branchId ?? null, role: user.role ?? '' };
    const doc = await this.ensureDraft(occ.template, occ.id, due, actor);
    void now;
    await this.logAudit(user, 'RECURRING_BILL_DRAFT_CREATED', occ, { documentId: doc.id, documentNumber: doc.number });
    return { occurrenceId: occ.id, documentId: doc.id, documentNumber: doc.number };
  }

  // ─── งานใน /todos ──────────────────────────────────────────────────────────

  private async createTodo(p: { occId: string; tpl: TemplateRow; due: CalendarDate; view: TodoView; daysOverdue: number; actorId: string; docNumber: string | null; draftFailed: boolean }) {
    const todo = await this.prisma.todo.create({
      data: {
        title: this.todoTitle(p.tpl, p.due, p.view, p.daysOverdue, p.docNumber),
        description: this.todoDescription(p.tpl, p.due, p.view, p.docNumber, p.draftFailed),
        priority: p.view === 'DUE_TODAY' || p.view === 'OVERDUE' ? 'HIGH' : 'MEDIUM',
        status: 'TODO',
        tags: [RECURRING_BILL_TODO_TAG, `rb:${p.occId}`],
        branchId: p.tpl.branchId,
        dueDate: bkkNoonOf(p.due),
        createdById: p.actorId,
      },
    });
    await this.prisma.recurringBillOccurrence.update({ where: { id: p.occId }, data: { todoId: todo.id } });
    return todo.id;
  }

  /** งวดที่ `todoId` ว่าง: ไม่เคยมีงาน (รวมที่ DONE/ถูกลบ) → สร้าง · เคยมีแต่ถูกลบ = คนลบ → ไม่สร้าง */
  private async repairTodo(row: OccurrenceRow, view: TodoView, daysOverdue: number, actorId: string): Promise<boolean> {
    const tag = `rb:${row.id}`;
    const existing = await this.prisma.todo.findFirst({
      where: { tags: { hasEvery: [RECURRING_BILL_TODO_TAG, tag] } },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      if (!existing.deletedAt) await this.prisma.recurringBillOccurrence.update({ where: { id: row.id }, data: { todoId: existing.id } });
      return false;
    }
    const due = bkkCalendarDate(row.dueDate);
    const docNumber = row.expenseDocument && !row.expenseDocument.deletedAt && row.expenseDocument.status !== 'VOIDED' ? row.expenseDocument.number : null;
    await this.createTodo({ occId: row.id, tpl: row.template, due, view, daysOverdue, actorId, docNumber, draftFailed: false });
    return true;
  }

  private async closeTodo(todoId: string, now: Date) {
    await this.prisma.todo.updateMany({
      where: { id: todoId, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } },
      data: { status: 'DONE', completedAt: now },
    });
  }

  private todoTitle(tpl: TemplateRow, due: CalendarDate, view: TodoView, daysOverdue: number, docNumber: string | null): string {
    const branch = tpl.branch?.name ?? 'ไม่ระบุสาขา';
    const base = `บิลประจำ: ${tpl.name} (${branch}) · ครบกำหนด ${formatCalendarDateTh(due)}`;
    switch (view) {
      case 'UPCOMING':
        return base;
      case 'DUE_TODAY':
        return `${base} · ครบกำหนดวันนี้`;
      case 'OVERDUE':
        return `${base} · เกินกำหนด ${daysOverdue} วัน`;
      case 'UNPOSTED':
        return docNumber
          ? `ลงบัญชีใบ ${docNumber} · ${tpl.name} (จ่ายแล้ว บันทึกเอง)`
          : `สร้างและลงบัญชีใบรายจ่าย · ${tpl.name} (จ่ายแล้ว บันทึกเอง)`;
      case 'MISSED':
        return `งวดหลุด — ตรวจว่าจ่ายแล้วหรือยัง: ${tpl.name} ครบ ${formatCalendarDateTh(due)}`;
    }
  }

  private todoDescription(tpl: TemplateRow, due: CalendarDate, view: TodoView, docNumber: string | null, draftFailed: boolean): string {
    const branch = tpl.branch?.name ?? 'ไม่ระบุสาขา';
    const lines = [
      `ผู้รับเงิน ${vendorNameOf(tpl.prefilledData) ?? '—'} · สาขา ${branch} · ยอดประมาณ ${amountText(estimatedAmountOf(tpl.prefilledData))} บาท`,
    ];
    if (view === 'MISSED') {
      lines.push('ระบบไม่ได้สร้างร่างให้งวดนี้ — ถ้าจ่ายแล้วกด "จ่ายแล้ว" ถ้ายังไม่จ่ายกด "เปิดใหม่" บนหน้าบิลประจำ');
    } else if (draftFailed) {
      lines.push('สร้างร่างไม่สำเร็จ — กดปุ่ม "สร้างร่างใหม่" บนหน้าบิลประจำ');
    } else if (docNumber) {
      lines.push(`ร่างใบรายจ่าย ${docNumber} · ถ้าจ่ายก่อนกำหนด ให้แก้วันที่เอกสารเป็นวันจ่ายจริงก่อนลงบัญชี`);
    } else {
      lines.push('ยังไม่มีร่างใบรายจ่าย');
    }
    if (view === 'UNPOSTED') {
      const rule = ruleOf(tpl);
      const monthLabel = rule ? formatPeriodLabelTh({ ...rule, recurrence: 'MONTHLY' }, monthParamOf(due)) : formatCalendarDateTh(due);
      lines.push(`ต้องลงบัญชีก่อนปิดงวด ${monthLabel}`);
    }
    lines.push(`หน้าบิลประจำ: ${RECURRING_BILL_PAGE_PATH}?month=${monthParamOf(due)}`);
    return lines.join('\n');
  }

  private async safeNotify(kind: RecurringBillEventKind, p: { occId: string; tpl: TemplateRow; due: CalendarDate; daysOverdue: number; docNumber: string | null }) {
    const base = process.env.PAYMENT_LINK_BASE_URL ?? process.env.FRONTEND_URL ?? '';
    const amount = estimatedAmountOf(p.tpl.prefilledData);
    try {
      await this.notifier.notify({
        kind,
        occurrenceId: p.occId,
        templateName: p.tpl.name,
        vendorName: vendorNameOf(p.tpl.prefilledData),
        branchName: p.tpl.branch?.name ?? 'ไม่ระบุสาขา',
        dueDate: p.due,
        daysOverdue: p.daysOverdue,
        amount: amount ? amount.toString() : null,
        documentNumber: p.docNumber,
        link: `${base}${RECURRING_BILL_PAGE_PATH}?month=${monthParamOf(p.due)}`,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'recurring-bills', stage: 'notify' }, extra: { occurrenceId: p.occId } });
      this.logger.warn(`[recurring-bills] notify failed for ${p.occId}: ${(err as Error).message}`);
    }
  }
}
