import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JOURNEY_ENTRY_KINDS, type JourneyEntryKind } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeJourneyData } from './journey-data-schemas';

/** แถว SYSTEM หนึ่งแถว — ห้ามใส่ข้อความแชท, callLog.notes, เบอร์, เลขบัตร, ที่อยู่ (data ผ่าน JOURNEY_DATA_SCHEMAS อีกชั้น) */
export interface JourneyEntryInput {
  customerId: string;
  kind: JourneyEntryKind;
  occurredAt: Date;
  actorType: 'STAFF' | 'CUSTOMER' | 'BOT' | 'SYSTEM';
  actorUserId?: string | null;
  roomId?: string | null;
  refType?: string | null;
  refId?: string | null;
  data?: Record<string, unknown>;
  /** สร้างด้วย journeyDedupeKey(kind, ...) เท่านั้น — unique ทั้งตาราง ⇒ hook ที่ยิงซ้ำ (retry, webhook ซ้ำ) ได้แถวเดียว */
  dedupeKey: string;
}

const SYSTEM_KINDS: ReadonlySet<string> = new Set<string>(JOURNEY_ENTRY_KINDS.SYSTEM);
const ACTOR_TYPES: ReadonlySet<string> = new Set<JourneyEntryInput['actorType']>(['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM']);
/** ความยาวคอลัมน์ ref_type @db.VarChar(24) — เกินแล้ว INSERT ล้มกลางทรานแซกชันของ absorbPlaceholder */
const REF_TYPE_MAX = 24;
const DEDUPE_KEY_MAX = 200;
const SENTRY_TAGS = { module: 'customer-journey' } as const;

/**
 * ตัวเขียน customer_journey_entries (origin=SYSTEM) — ผู้เรียกอยู่ในเส้นทางธุรกิจ (สัญญา เครดิต แชท) จึงแยกสองทาง:
 * - recordAfterCommit: เรียก **หลัง** ทรานแซกชันของโดเมน commit แล้ว ใช้ this.prisma ของตัวเอง ห้ามส่ง tx ของโดเมนเงินเข้ามา
 *   ไม่โยนเด็ดขาด (ล้ม = Logger.warn + Sentry) เพราะประวัติการเดินทางต้องไม่ทำให้การขาย/รับเงินล้ม
 * - recordInTx: ใช้ได้ที่เดียวคือ CustomerMergeService.absorbPlaceholder — error ของฐานข้อมูลโยนต่อ
 *   เพราะ Postgres ยกเลิกทรานแซกชันทั้งก้อนอยู่แล้ว กลืนไว้ก็แค่ทำให้คำสั่งถัดไปล้มแบบหาสาเหตุไม่เจอ
 * ทั้งสองทาง: createMany + skipDuplicates (ON CONFLICT DO NOTHING บน dedupe_key) ⇒ ยิงซ้ำได้แถวเดียวและไม่ทำให้ทรานแซกชันพัง
 * แถวที่ข้อมูลบังคับไม่ครบ/ไม่ใช่ kind ของ SYSTEM ถูกข้าม (warn + Sentry) · data ไม่ผ่าน whitelist → เก็บแถวโดยไม่มี data
 */
@Injectable()
export class JourneyEntryWriter {
  private readonly logger = new Logger(JourneyEntryWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAfterCommit(entry: JourneyEntryInput): Promise<void> {
    try {
      const row = this.toRow(entry);
      if (!row) return;
      await this.prisma.customerJourneyEntry.createMany({ data: [row], skipDuplicates: true });
    } catch (err) {
      this.logger.warn(
        `[journey] เขียน ${entry.kind} ไม่สำเร็จ (customer ${entry.customerId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, {
        tags: { ...SENTRY_TAGS, action: 'record_after_commit' },
        extra: { kind: entry.kind, dedupeKey: entry.dedupeKey },
      });
    }
  }

  async recordInTx(tx: Prisma.TransactionClient, entry: JourneyEntryInput): Promise<void> {
    const row = this.toRow(entry);
    if (!row) return;
    await tx.customerJourneyEntry.createMany({ data: [row], skipDuplicates: true });
  }

  private toRow(entry: JourneyEntryInput): Prisma.CustomerJourneyEntryCreateManyInput | null {
    const problem = this.invalidReason(entry);
    if (problem) {
      this.logger.warn(`[journey] ข้ามแถว ${entry.kind}: ${problem}`);
      Sentry.captureException(new Error(`customer-journey: ${problem}`), {
        tags: { ...SENTRY_TAGS, action: 'reject_entry' },
        extra: { kind: entry.kind, dedupeKey: entry.dedupeKey },
      });
      return null;
    }

    const sanitized = sanitizeJourneyData(entry.kind, entry.data ?? {});
    if (!sanitized.ok) {
      this.logger.warn(`[journey] ${entry.kind} data ไม่ผ่าน whitelist ถูกตัดทิ้ง: ${sanitized.issues.join(', ')}`);
      Sentry.captureMessage('customer-journey: data ไม่ผ่าน JOURNEY_DATA_SCHEMAS — เก็บแถวโดยไม่มี data', {
        level: 'warning',
        tags: { ...SENTRY_TAGS, action: 'strip_data' },
        extra: { kind: entry.kind, issues: sanitized.issues },
      });
    }
    const data =
      sanitized.ok && Object.keys(sanitized.data).length > 0 ? (sanitized.data as Prisma.InputJsonObject) : undefined;

    return {
      customerId: entry.customerId,
      originCustomerId: entry.customerId,
      origin: 'SYSTEM',
      kind: entry.kind,
      occurredAt: entry.occurredAt,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      roomId: entry.roomId ?? null,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      data,
      dedupeKey: entry.dedupeKey.trim(),
    };
  }

  private invalidReason(entry: JourneyEntryInput): string | null {
    if (!SYSTEM_KINDS.has(entry.kind)) return `kind ${entry.kind} ไม่ใช่ SYSTEM (บันทึกมือเขียนผ่าน endpoint ของตัวเอง)`;
    if (!entry.customerId) return 'ไม่มี customerId';
    if (!(entry.occurredAt instanceof Date) || Number.isNaN(entry.occurredAt.getTime())) return 'occurredAt ไม่ใช่วันที่ที่ถูกต้อง';
    if (!ACTOR_TYPES.has(entry.actorType)) return `actorType ${entry.actorType} ไม่รู้จัก`;
    const key = typeof entry.dedupeKey === 'string' ? entry.dedupeKey.trim() : '';
    if (!key) return 'ไม่มี dedupeKey';
    if (key.length > DEDUPE_KEY_MAX) return `dedupeKey ยาวเกิน ${DEDUPE_KEY_MAX}`;
    if (entry.refType && entry.refType.length > REF_TYPE_MAX) return `refType ยาวเกิน ${REF_TYPE_MAX}`;
    return null;
  }
}
