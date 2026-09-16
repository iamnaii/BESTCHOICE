import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneyEntryCreatedResponse, JourneyEntryDeletedResponse, JourneyManualEntryKind, JourneyRedirect, JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import type { JourneyActor } from './sources/journey-window';
import { canDeleteManualEntry, MANUAL_ENTRY_EVENT_SELECT, manualEntryToEvent, type ManualEntryEventRow } from './sources/manual-entry-event';

/** dedupe_key ของบันทึกมือ — มี kind ในคีย์: แตะ "ซื้อที่อื่น" แล้วกด "ใช่ ติดป้ายหลุด" เป็นคนละคำขอ ต้องไม่ชนกัน */
export const manualEntryDedupeKey = (kind: JourneyManualEntryKind, clientRequestId: string): string => `MANUAL:${kind}:${clientRequestId}`;

/** แถวที่เจอด้วย dedupe_key — ต้องรู้เจ้าของและสถานะเลิกทำก่อนคืน */
const DEDUPE_HIT_SELECT = { ...MANUAL_ENTRY_EVENT_SELECT, customerId: true, deletedAt: true } satisfies Prisma.CustomerJourneyEntrySelect;
type DedupeHit = ManualEntryEventRow & { customerId: string; deletedAt: Date | null };

const isRedirect = (value: JourneySummary | JourneyRedirect): value is JourneyRedirect => 'redirectToCustomerId' in value;
const isUniqueViolation = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** คอลัมน์เฉพาะของ kind นั้น — ช่องของ kind อื่นที่หลุดมากับ body ไม่ถูกเขียน (ValidateIf ไม่ตัดทิ้ง) */
function kindColumns(dto: CreateJourneyEntryDto) {
  return {
    channel: dto.kind === 'TOUCHPOINT' ? (dto.channel ?? null) : null,
    outcome: dto.kind === 'TOUCHPOINT' ? (dto.outcome ?? null) : null,
    lostReason: dto.kind === 'MARKED_LOST' ? (dto.lostReason ?? null) : null,
    heardFrom: dto.kind === 'HEARD_FROM' ? (dto.heardFrom ?? null) : null,
  };
}

/**
 * บันทึกมือแบบแตะเดียว (POST /customers/:id/journey/entries) — ขอบเขต v2: ไม่มีโน้ต ไม่มีเปลี่ยนเวลา ไม่มี roomId
 * ไม่ใช้ JourneyEntryWriter (รับเฉพาะ SYSTEM + กลืน error) · ไม่มี $transaction: แถวเดียว และ recompute ต้องรันหลัง commit อยู่แล้ว
 */
@Injectable()
export class JourneyManualEntryService {
  private readonly logger = new Logger(JourneyManualEntryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journeyState: JourneyStateService,
    private readonly summaries: JourneySummaryService,
  ) {}

  async create(customerId: string, dto: CreateJourneyEntryDto, actor: JourneyActor): Promise<JourneyEntryCreatedResponse> {
    const { targetId, familyIds } = await this.resolveFamily(customerId);
    const dedupeKey = dto.clientRequestId ? manualEntryDedupeKey(dto.kind, dto.clientRequestId) : null;

    // retry ของคำขอที่สำเร็จไปแล้ว: คืนผลเดิมก่อนตรวจกติกา kind (สถานะลูกค้าอาจเปลี่ยนระหว่างรอบแรกกับรอบ retry)
    const previous = dedupeKey ? await this.findByDedupeKey(dedupeKey) : null;
    if (previous) return this.replay(previous, targetId, familyIds, actor);

    if (dto.kind === 'MARKED_LOST') {
      const bought = await this.prisma.customer.count({ where: { AND: [{ id: targetId }, BOUGHT_WHERE] } });
      if (bought > 0) throw new ConflictException('ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้');
    }
    if (dto.kind === 'REOPENED') {
      // "หลุด" คือค่าที่คำนวณแล้ว (ข้อความลูกค้า / การติดต่อ / เอกสารใหม่ล้างป้ายได้เอง) — คำนวณแคชก่อนอ่าน กันแคชค้างจาก recompute ที่เคยล้ม
      await this.recomputeQuietly(targetId);
      const current = await this.freshSummary(targetId, actor);
      if (current.lost === null) return { entryId: null, event: null, summary: current };
    }

    const now = new Date();
    let row: ManualEntryEventRow;
    try {
      row = await this.prisma.customerJourneyEntry.create({
        data: {
          customerId: targetId,
          originCustomerId: targetId,
          origin: 'MANUAL',
          kind: dto.kind,
          occurredAt: now,
          actorType: 'STAFF',
          actorUserId: actor.id,
          roomId: null,
          refType: null,
          refId: null,
          note: null,
          ...kindColumns(dto),
          dedupeKey,
        },
        select: MANUAL_ENTRY_EVENT_SELECT,
      });
    } catch (err) {
      // สองคำขอ clientRequestId เดียวกันผ่านด่านค้นพร้อมกัน — ตัวที่แพ้ unique คืนแถวของตัวที่ชนะ
      const winner = dedupeKey && isUniqueViolation(err) ? await this.findByDedupeKey(dedupeKey) : null;
      if (!winner) throw err;
      return this.replay(winner, targetId, familyIds, actor);
    }

    await this.recomputeQuietly(targetId);
    const event = manualEntryToEvent(row, actor, now);
    return { entryId: row.id, event, summary: await this.freshSummary(targetId, actor) };
  }

  /**
   * DELETE /customers/:id/journey/entries/:entryId — "เลิกทำ" แถวที่พนักงานกดเอง (soft delete)
   * ด่านตามลำดับ: ลูกค้าไม่พบ 404 → รายการไม่พบ/ไม่ใช่ของครอบครัว 404 → ไม่ใช่ MANUAL 400 → สิทธิ์ 403 → ลบไปแล้ว 200 ไม่เขียนซ้ำ
   * สิทธิ์ = canDeleteManualEntry ตัวเดียวกับ canDelete บนแถวไทม์ไลน์ (หน้าต่าง 24 ชม. นับจาก createdAt ไม่ใช่ occurredAt)
   */
  async remove(customerId: string, entryId: string, actor: JourneyActor): Promise<JourneyEntryDeletedResponse> {
    // กติกาครอบครัวเดียวกับ create() — placeholder ที่รวมแล้วตามไปลูกค้าจริง · ไม่พบ/ถูกลบ = 404 'ไม่พบลูกค้า'
    const { targetId, familyIds } = await this.resolveFamily(customerId);
    const entry = await this.prisma.customerJourneyEntry.findUnique({
      where: { id: entryId },
      select: { id: true, customerId: true, origin: true, actorUserId: true, createdAt: true, deletedAt: true },
    });
    if (!entry || !familyIds.includes(entry.customerId)) throw new NotFoundException('ไม่พบรายการนี้');
    if (entry.origin !== 'MANUAL') throw new BadRequestException('ลบได้เฉพาะรายการที่พนักงานบันทึกเอง');
    const now = new Date();
    if (!canDeleteManualEntry(entry, actor, now)) throw new ForbiddenException('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');

    if (!entry.deletedAt) {
      // compare-and-set: กดเลิกทำพร้อมกันสองที่ = แถวถูกลบครั้งเดียว อีกคำขอได้ count 0 แล้วคืน summary เฉย ๆ
      const { count } = await this.prisma.customerJourneyEntry.updateMany({
        where: { id: entry.id, origin: 'MANUAL', deletedAt: null, customerId: { in: familyIds } },
        data: { deletedAt: now, deletedById: actor.id },
      });
      if (count > 0) {
        try {
          await this.journeyState.recompute([targetId]);
        } catch (err) {
          // แถวถูกลบแล้ว — คำตอบต้องไม่เป็น 500 · แคชค้างได้จนหมดอายุ 15 นาที/cron คืนนี้
          this.logger.warn(`journey undo recompute ล้ม customer=${targetId}: ${err instanceof Error ? err.message : err}`);
          Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-undo-recompute' } });
        }
      }
    }

    const summary = await this.summaries.summary(targetId, actor);
    // ครอบครัวเริ่มจากลูกค้าที่ยังไม่ถูกลบเสมอ — redirect ตรงนี้ไม่ควรเกิด
    if (isRedirect(summary)) throw new NotFoundException('ไม่พบลูกค้า');
    return { summary };
  }

  /** placeholder ที่รวมแล้วเขียนไปที่ลูกค้าจริง — chain ถูกยุบเหลือชั้นเดียวตอนรวม · ครอบครัว = ลูกค้าจริง + placeholder ที่ชี้มา */
  private async resolveFamily(customerId: string): Promise<{ targetId: string; familyIds: string[] }> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    const targetId = customer && !customer.deletedAt ? customer.id : (customer?.mergedIntoId ?? null);
    if (!targetId) throw new NotFoundException('ไม่พบลูกค้า');
    if (targetId !== customerId) {
      const target = await this.prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
      if (!target || target.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    }
    const absorbed = await this.prisma.customer.findMany({ where: { mergedIntoId: targetId }, select: { id: true } });
    return { targetId, familyIds: [targetId, ...absorbed.map((row) => row.id)] };
  }

  private findByDedupeKey(dedupeKey: string): Promise<DedupeHit | null> {
    return this.prisma.customerJourneyEntry.findUnique({ where: { dedupeKey }, select: DEDUPE_HIT_SELECT });
  }

  /** แถวของ clientRequestId เดิม — ถูกเลิกทำแล้ว / เป็นของครอบครัวอื่น = คำขอนี้ใช้ไปแล้วจริง (แตะใหม่ได้ UUID ใหม่ จึงกดใหม่ได้จริง) */
  private async replay(hit: DedupeHit, targetId: string, familyIds: string[], actor: JourneyActor): Promise<JourneyEntryCreatedResponse> {
    if (hit.deletedAt || !familyIds.includes(hit.customerId)) throw new ConflictException('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
    return { entryId: hit.id, event: manualEntryToEvent(hit, actor, new Date()), summary: await this.freshSummary(targetId, actor) };
  }

  /** ลูกค้าถูกรวมเข้าคนอื่นระหว่างคำขอ (การรวมย้ายแถว entries ตามไปแล้ว) — ตามได้ชั้นเดียวเพราะ chain ถูกยุบ */
  private async freshSummary(targetId: string, actor: JourneyActor): Promise<JourneySummary> {
    const summary = await this.summaries.summary(targetId, actor);
    if (!isRedirect(summary)) return summary;
    const moved = await this.summaries.summary(summary.redirectToCustomerId, actor);
    if (isRedirect(moved)) throw new NotFoundException('ไม่พบลูกค้า');
    return moved;
  }

  /** แคชต้องสดในคำตอบนี้ (summary ข้ามแคชที่อายุไม่เกิน 15 นาที) · ล้มแล้วคำขอไม่ล้ม — cron journey:recompute ซ่อมเอง */
  private async recomputeQuietly(targetId: string): Promise<void> {
    try {
      await this.journeyState.recompute([targetId]);
    } catch (err) {
      this.logger.warn(`journey manual entry recompute ล้ม customer=${targetId}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'manual-entry-recompute' } });
    }
  }
}
