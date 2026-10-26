import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpenseDocumentsService } from './expense-documents.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { TEMPLATES_DISABLED_MESSAGE, isTemplatesEnabled } from './templates-flag.util';
import { CASH_ACCOUNT_CODES } from '../../constants/cash-account.constants';
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';
import {
  RECURRING_BILL_DEFAULT_LEAD_DAYS,
  RECURRING_BILL_LEAD_DAYS_MAX,
  RECURRING_BILL_STARTS_ON_MAX_FUTURE_DAYS,
  RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS,
} from '@installment/shared';

export interface UserContext {
  id: string;
  branchId?: string | null;
  role?: string;
}

/** วิธีจ่ายที่บิลประจำตั้งล่วงหน้าได้ (ค่าของ enum PaymentMethod ที่มีความหมายกับรายจ่าย) */
export const RECURRING_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'QR_EWALLET', 'CARD'] as const;

interface RecurringFields {
  isRecurring?: boolean | null;
  recurrence?: string | null;
  recurringDay?: number | null;
  recurringMonth?: number | null;
  reminderLeadDays?: number | null;
  documentType?: string;
  prefilledData?: unknown;
}

/**
 * กติกาบิลประจำ (spec §8 + §15.5) — ตรวจบน **แถวที่รวมแล้ว** (`{...tpl, ...dto}`) ทั้ง create และ update
 * เพราะ UpdateTemplateDto เป็น Partial — ฟิลด์คู่ (isRecurring⇔recurrence, QUARTERLY⇔recurringMonth) ตรวจทีละ body ไม่ได้
 */
export function assertRecurringRule(m: RecurringFields): void {
  const pf = (m.prefilledData ?? {}) as Record<string, unknown>;
  if (pf.paymentMethod != null && !(RECURRING_PAYMENT_METHODS as readonly string[]).includes(String(pf.paymentMethod))) {
    throw new BadRequestException('วิธีจ่ายของบิลต้องเป็น เงินสด / โอน / QR / บัตร');
  }
  if (pf.depositAccountCode != null && !(CASH_ACCOUNT_CODES as readonly string[]).includes(String(pf.depositAccountCode))) {
    throw new BadRequestException('บัญชีที่จ่ายไม่อยู่ในรายการบัญชีเงินสด/ธนาคาร');
  }
  if (!m.isRecurring) return;
  if (m.documentType !== 'EXPENSE') {
    throw new BadRequestException('บิลประจำสร้างได้เฉพาะใบรายจ่าย — เงินเดือน/ใบจ่ายเจ้าหนี้ตั้งเป็นบิลประจำไม่ได้');
  }
  if (!m.recurrence) {
    throw new BadRequestException('บิลประจำต้องระบุความถี่ (รายเดือน / ราย 3 เดือน / รายปี)');
  }
  if (m.recurringDay == null || m.recurringDay < 1 || m.recurringDay > 31) {
    throw new BadRequestException('บิลประจำต้องระบุวันครบกำหนด 1-31');
  }
  const month = m.recurringMonth ?? null;
  if (m.recurrence === 'QUARTERLY' && (month == null || month < 1 || month > 3)) {
    throw new BadRequestException('ราย 3 เดือนต้องระบุว่าเป็นเดือนที่ 1-3 ของไตรมาส');
  }
  if (m.recurrence === 'YEARLY' && (month == null || month < 1 || month > 12)) {
    throw new BadRequestException('รายปีต้องระบุเดือน 1-12');
  }
  if (m.recurrence === 'MONTHLY' && month != null) {
    throw new BadRequestException('รายเดือนไม่ต้องระบุเดือน');
  }
  const lead = m.reminderLeadDays ?? RECURRING_BILL_DEFAULT_LEAD_DAYS;
  if (lead < 0 || lead > RECURRING_BILL_LEAD_DAYS_MAX) {
    throw new BadRequestException(`เตือนล่วงหน้าได้ 0-${RECURRING_BILL_LEAD_DAYS_MAX} วัน`);
  }
}

/** เที่ยงคืนไทยของวันนี้ */
export function bkkTodayMidnight(now: Date = new Date()): Date {
  const p = bangkokCalendarParts(now);
  return bangkokMidnight(p.year, p.month, p.day);
}

/**
 * `YYYY-MM-DD` → เที่ยงคืนไทย · ตรวจช่วง [วันนี้−90, วันนี้+365] (spec §15.1)
 * `unchangedFrom` = ค่าที่เก็บอยู่ (กล่องแก้ไขสะท้อนค่าเดิมกลับมา) — ค่าเดิมไม่ตรวจช่วง ไม่งั้นบิลที่เริ่มนับเกิน 90 วันแก้อะไรไม่ได้ (รีวิว I2)
 */
export function normalizeStartsOn(input: string, now: Date = new Date(), unchangedFrom?: Date | null): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) throw new BadRequestException('วันเริ่มนับงวดต้องเป็นรูปแบบ YYYY-MM-DD');
  const value = bangkokMidnight(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (unchangedFrom && value.getTime() === unchangedFrom.getTime()) return value;
  const diffDays = Math.round((value.getTime() - bkkTodayMidnight(now).getTime()) / 86_400_000);
  if (diffDays < -RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS) {
    throw new BadRequestException(`วันเริ่มนับงวดย้อนหลังได้ไม่เกิน ${RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS} วัน`);
  }
  if (diffDays > RECURRING_BILL_STARTS_ON_MAX_FUTURE_DAYS) {
    throw new BadRequestException('วันเริ่มนับงวดล่วงหน้าได้ไม่เกิน 1 ปี');
  }
  return value;
}

@Injectable()
export class ExpenseTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ExpenseDocumentsService))
    private readonly docs: ExpenseDocumentsService,
  ) {}

  private assertBranchAccess(branchId: string, user: UserContext) {
    if (hasCrossBranchAccess(user)) return;
    if (user.branchId !== branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึง template ในสาขาอื่นได้');
    }
  }

  /**
   * D1.2.4.2 — read per-user template cap from SystemConfig. Reads
   * direct from SystemConfig (avoids SettingsService injection — same
   * reason as the readBoolFlag pattern in ExpenseDocumentsService).
   * Default 20, clamped to 1–1000 to neutralise bad SystemConfig rows.
   * Accepts a tx client so the read happens inside the same transaction
   * as the create() — see TOCTOU note on create().
   */
  private async readUserQuotaCap(
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<number> {
    return readTemplateQuotaCap(client);
  }

  /**
   * D1.2.4.1 — global feature flag for Expense Templates. Read direct from
   * SystemConfig (avoids SettingsService injection — keeps the ctor lean
   * and dodges potential audit↔settings circular dep). Default true so
   * legacy behaviour is preserved when the SystemConfig row is missing.
   *
   * Gates WRITE paths only (create/update/delete/instantiate). Read paths
   * (list/findOne) stay open so OWNER can disable the feature without
   * hiding pre-existing templates from auditors.
   */
  private async assertTemplatesEnabled(): Promise<void> {
    // ตรรกะอยู่ที่ `templates-flag.util.ts` (ใช้ร่วมกับบิลประจำ) — explicit 'false'/'0' เท่านั้นที่ปิด
    if (!(await isTemplatesEnabled(this.prisma))) {
      throw new ForbiddenException(TEMPLATES_DISABLED_MESSAGE);
    }
  }

  async create(dto: CreateTemplateDto, user: UserContext) {
    await this.assertTemplatesEnabled();
    this.assertBranchAccess(dto.branchId, user);
    // CN ผูกกับเอกสารต้นฉบับเฉพาะตัว — บันทึกเป็น template ไม่ได้
    // (originalDocumentId จะ stale + cumulative cap จะหมดเมื่อใช้รอบสอง)
    if (dto.documentType === 'CREDIT_NOTE') {
      throw new BadRequestException(
        'ใบลดหนี้บันทึกเป็นรายการโปรดไม่ได้ — แต่ละใบลดหนี้ต้องผูกกับเอกสารต้นฉบับเฉพาะ',
      );
    }
    assertRecurringRule(dto);
    const isRecurring = dto.isRecurring ?? false;
    const startsOn = isRecurring ? (dto.startsOn ? normalizeStartsOn(dto.startsOn) : bkkTodayMidnight()) : null;
    // D1.2.4.2 — TOCTOU-safe quota: count + cap-read + insert all happen
    // inside a single transaction. Two concurrent create() calls under
    // load can no longer both read `count = cap-1` then both insert
    // through to cap+1, because Prisma's `$transaction` uses Read
    // Committed snapshot semantics for each statement — under contention
    // the second tx's COUNT sees the first tx's pending INSERT once it
    // commits, so the second tx hits the cap and rejects. (Strict
    // SERIALIZABLE would be ideal but isn't on by default; the window
    // is still narrow enough that user-facing burst-create is safe.)
    return this.prisma.$transaction(async (tx) => {
      const cap = await this.readUserQuotaCap(tx);
      // โควต้านับเฉพาะรายการโปรดส่วนตัว — บิลประจำเป็นของร้าน ไม่นับ (spec §13 ข้อ 5)
      const existing = await tx.expenseTemplate.count({
        where: { createdById: user.id, deletedAt: null, isRecurring: false },
      });
      if (!isRecurring && existing >= cap) {
        throw new BadRequestException(
          'โควต้าเทมเพลตเต็มแล้ว — ลบเทมเพลตเก่าก่อนสร้างใหม่',
        );
      }
      return tx.expenseTemplate.create({
        data: {
          name: dto.name,
          documentType: dto.documentType as never,
          branchId: dto.branchId,
          prefilledData: dto.prefilledData as Prisma.InputJsonValue,
          isRecurring,
          recurringDay: dto.recurringDay ?? null,
          recurrence: isRecurring ? (dto.recurrence as never) : null,
          recurringMonth: isRecurring ? (dto.recurringMonth ?? null) : null,
          reminderLeadDays: dto.reminderLeadDays ?? RECURRING_BILL_DEFAULT_LEAD_DAYS,
          startsOn,
          createdById: user.id,
        },
      });
    });
  }

  async list(filters: { branchId?: string; type?: string }, user: UserContext) {
    const where: Prisma.ExpenseTemplateWhereInput = { deletedAt: null };

    // Branch-scope enforcement.
    // Cross-branch roles (OWNER / FINANCE_MANAGER / ACCOUNTANT) see ALL
    //   templates by default, optionally filtered by ?branchId.
    // Single-branch roles (SALES / BRANCH_MANAGER) MUST be locked to
    //   `user.branchId`. The previous logic fell through to
    //   `filters.branchId` when `user.branchId` was nullish, which let a
    //   single-branch user pass `?branchId=<anyOtherBranchId>` and read
    //   templates from a sibling shop. We now ignore the filter for
    //   single-branch users (or 403 if their branchId is missing — a
    //   misconfigured user record is a programming error, not a security
    //   bypass).
    if (hasCrossBranchAccess(user)) {
      if (filters.branchId) where.branchId = filters.branchId;
    } else {
      if (!user.branchId) {
        throw new ForbiddenException('ผู้ใช้งานยังไม่ได้ผูกกับสาขา ไม่สามารถดูรายการโปรดได้');
      }
      where.branchId = user.branchId;
    }

    if (filters.type) where.documentType = filters.type as never;
    // Hard cap on rows returned. Favorites are user-curated so this should
    // never realistically be hit, but it prevents an unbounded findMany if a
    // future caller floods the table.
    // TODO: switch to cursor pagination when a shop legitimately exceeds this.
    // Returning the cap silently is acceptable today because the UI only
    // surfaces the most recent + recurring entries first via the orderBy.
    return this.prisma.expenseTemplate.findMany({
      where,
      orderBy: [{ isRecurring: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string, user: UserContext) {
    const tpl = await this.prisma.expenseTemplate.findUniqueOrThrow({ where: { id } });
    if (tpl.deletedAt) throw new NotFoundException('Template ถูกลบไปแล้ว');
    this.assertBranchAccess(tpl.branchId, user);
    return tpl;
  }

  /**
   * แก้แม่แบบ — กติกาบิลประจำตรวจบนแถวที่รวมแล้ว · `ruleChanged` = ความถี่/วัน/เดือนเปลี่ยน หรือเพิ่งเปิดเป็นบิลประจำ
   * (ผู้เรียกใช้ปิดงวดค้างของกติกาเดิมแล้วสร้างงวดใหม่ — spec §15.5) · เปลี่ยนกติกา ⇒ `startsOn` เลื่อนมาอย่างน้อยวันนี้
   */
  async update(id: string, dto: UpdateTemplateDto, user: UserContext) {
    await this.assertTemplatesEnabled();
    const tpl = await this.findOne(id, user);
    const isRecurring = dto.isRecurring ?? tpl.isRecurring;
    const merged = {
      ...tpl,
      ...dto,
      isRecurring,
      documentType: tpl.documentType,
      prefilledData: dto.prefilledData ?? tpl.prefilledData,
      // สลับมารายเดือนโดยไม่ส่งเดือน = ล้างเดือนให้เอง
      recurringMonth:
        dto.recurringMonth !== undefined ? dto.recurringMonth : dto.recurrence === 'MONTHLY' ? null : tpl.recurringMonth,
    };
    assertRecurringRule(merged);

    const ruleChanged =
      isRecurring &&
      (!tpl.isRecurring ||
        merged.recurrence !== tpl.recurrence ||
        merged.recurringDay !== tpl.recurringDay ||
        (merged.recurringMonth ?? null) !== (tpl.recurringMonth ?? null));

    const data: Prisma.ExpenseTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.prefilledData !== undefined) data.prefilledData = dto.prefilledData as Prisma.InputJsonValue;
    if (dto.isRecurring !== undefined) data.isRecurring = dto.isRecurring;
    if (dto.recurringDay !== undefined) data.recurringDay = dto.recurringDay;
    if (dto.reminderLeadDays !== undefined) data.reminderLeadDays = dto.reminderLeadDays;
    if (!isRecurring) {
      data.recurrence = null;
      data.recurringMonth = null;
    } else {
      if (dto.recurrence !== undefined) data.recurrence = dto.recurrence as never;
      if (dto.recurringMonth !== undefined || dto.recurrence === 'MONTHLY') data.recurringMonth = merged.recurringMonth ?? null;
      // รีวิว I2: ค่าเดิมที่สะท้อนกลับมาไม่ตรวจช่วง · เปลี่ยนกติกา ⇒ startsOn = max(ค่าที่ได้, วันนี้) เสมอ (สเปก §15.5)
      const provided = dto.startsOn ? normalizeStartsOn(dto.startsOn, new Date(), tpl.startsOn) : null;
      if (ruleChanged) {
        const today = bkkTodayMidnight();
        const base = provided ?? tpl.startsOn;
        data.startsOn = base && base.getTime() > today.getTime() ? base : today;
      } else if (provided && (!tpl.startsOn || provided.getTime() !== tpl.startsOn.getTime())) {
        data.startsOn = provided;
      }
    }
    const updated = await this.prisma.expenseTemplate.update({ where: { id }, data });
    return { ...updated, ruleChanged };
  }

  async softDelete(id: string, user: UserContext) {
    await this.assertTemplatesEnabled();
    const tpl = await this.prisma.expenseTemplate.findUniqueOrThrow({ where: { id } });
    if (tpl.deletedAt) throw new BadRequestException('Template ถูกลบไปแล้ว');
    this.assertBranchAccess(tpl.branchId, user);
    return this.prisma.expenseTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Create new DRAFT document from template's prefilledData.
   * Maps each documentType to the right ExpenseDocumentsService.create*() method.
   */
  async instantiate(id: string, user: UserContext, override?: { documentDate?: Date }) {
    await this.assertTemplatesEnabled();
    const tpl = await this.findOne(id, user);
    const today = override?.documentDate ?? new Date();
    const documentDate = today.toISOString();
    const data = tpl.prefilledData as Record<string, unknown>;

    switch (tpl.documentType) {
      case 'EXPENSE': {
        // V4 multi-line: synthesize one line from the legacy single-category template.
        // amount is placeholder (0.01); user must edit unitPrice before posting.
        return this.docs.create({
          ...data,
          documentType: 'EXPENSE',
          branchId: tpl.branchId,
          documentDate,
          fromTemplateId: tpl.id,
          lines: [{
            category: (data.category as string) || '53-1302',
            description: (data.description as string) || tpl.name,
            quantity: 1,
            unitPrice: (data.sampleAmount as number) ?? 0.01,
            discount: 0,
            vatPercent: 0,
            whtPercent: 0,
          }],
        } as never, user.id);
      }
      case 'CREDIT_NOTE': {
        // Defensive — create() rejects CREDIT_NOTE templates, but legacy rows
        // from before that guard could still exist.
        throw new BadRequestException(
          'ใบลดหนี้สร้างจากรายการโปรดไม่ได้ — กรุณาเปิดเอกสารต้นฉบับแล้วกด "ออกใบลดหนี้"',
        );
      }
      case 'PAYROLL': {
        // payrollPeriod = current month YYYY-MM
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        return this.docs.createPayroll({
          ...data,
          branchId: tpl.branchId,
          documentDate,
          payrollPeriod: `${y}-${m}`,
          lines: (data.lines as unknown[]) ?? [],
          fromTemplateId: tpl.id,
        } as never, user);
      }
      case 'VENDOR_SETTLEMENT': {
        return this.docs.createSettlement({
          ...data,
          branchId: tpl.branchId,
          documentDate,
          lines: (data.lines as unknown[]) ?? [],
          fromTemplateId: tpl.id,
        } as never, user);
      }
      default:
        throw new BadRequestException(`Unknown documentType ${tpl.documentType}`);
    }
  }
}

/**
 * โควต้าแม่แบบต่อผู้ใช้ (`max_templates_per_user`, ค่าเริ่มต้น 20, clamp 1–1000) — ใช้ร่วมกันระหว่าง
 * การสร้างแม่แบบและการกู้คืนจากถังขยะ (ก้อน 8 A10) เพื่อไม่ให้มีสูตรโควต้าสองชุด
 */
export async function readTemplateQuotaCap(
  client: Prisma.TransactionClient | PrismaService,
): Promise<number> {
  const row = await client.systemConfig
    .findFirst({
      where: { key: 'max_templates_per_user', deletedAt: null },
      select: { value: true },
    })
    .catch(() => null);
  const raw = row?.value ? Number(row.value) : NaN;
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 1000) : 20;
}

