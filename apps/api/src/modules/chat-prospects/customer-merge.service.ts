import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JourneyStateService } from '../customer-journey/journey-state.service';
import { BLOCKING_COUNT_SELECT, BLOCKING_RELATIONS, BlockingKey } from './customer-blocking-relations';
import { PLACEHOLDER_FIELDS_SELECT, isChatPlaceholder, isLivePlaceholder } from './chat-placeholder';

export interface MergeActor { id: string; role: string }
export interface AbsorbResult { placeholderId: string; targetId: string; movedRooms: number; movedCreditChecks: number }

/** ทางที่ลูกค้าทำเอง (พิมพ์เบอร์ใน LINE / LIFF / OTP) ไม่มีพนักงาน — audit ระบุระบบ */
export const SYSTEM_ACTOR: MergeActor = { id: 'system', role: 'SYSTEM' };

/** relation ที่ placeholder ห้ามมี (สเปค 3.3) — แหล่งเดียวอยู่ที่ customer-blocking-relations.ts */
const COUNT_SELECT = BLOCKING_COUNT_SELECT;

/** ช่องที่ใช้ตัดสิน/ยกที่มาตอนรวม (Ruling R24) + สถานะเครดิตเดิม — อ่านทั้งสองฝั่งด้วย select ชุดเดียว */
const SOURCE_COPY_SELECT = {
  creditCheckStatus: true,
  createdAt: true,
  facebookUserId: true,
  facebookName: true,
} as const;

/** เวลาเก่าสุดที่ไม่ว่าง — ใช้กับค่าแช่แข็งของแคชการเดินทาง */
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * รวม "ผู้สนใจอัตโนมัติจากแชท" เข้าลูกค้าตัวจริง — ทางเดียว ไม่ใช่ merge ลูกค้าทั่วไป
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.3)
 * ย้ายเฉพาะ: ห้องแชท · CreditCheck ที่ import จากห้อง (updateMany ตรง — linkRoomCreditHistory ย้ายเฉพาะ
 * ผลที่ยังไม่ import) · แท็ก · crmLeads · adsAttributions · chatAutoTriggers · บันทึกการเดินทาง (customer_journey_entries)
 * แล้ว soft-delete placeholder คู่ merged_into_id — ทุกทางรวม (ผูกห้อง / absorb-into / รวมห้องแชท / OTP / LIFF /
 * พิมพ์เบอร์ใน LINE) มาที่เมธอดนี้ จึงแก้การเดินทางที่เดียวครอบทุกทาง
 */
@Injectable()
export class CustomerMergeService {
  private readonly logger = new Logger(CustomerMergeService.name);
  private systemUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journeyEntries: JourneyEntryWriter,
    private readonly journeyState: JourneyStateService,
  ) {}

  /**
   * Ruling R12 — AuditLog.userId มี FK จริงไป User.id (audit_logs_user_id_fkey) และ
   * SYSTEM_ACTOR.id = 'system' ไม่ใช่แถวที่มีอยู่จริง เขียนแล้วชน FK เงียบ ๆ เพราะ
   * AuditService.log กลืน error ทุกกรณี (audit.service.ts) ⇒ ไม่มีแถว audit เลยโดยไม่มีใครรู้
   * เมื่อ actor เป็น SYSTEM. แก้ด้วยการ resolve เป็น userId จริงก่อนเขียน audit เสมอ โดยใช้ idiom
   * ที่มีอยู่แล้วในโค้ด — แถว User ที่ `isSystemUser: true` (seed โดย
   * `apps/api/prisma/seeds/collections-foundation.seed.ts`, รันทั้ง dev seed.ts + prod
   * seed-production.ts) แบบเดียวกับ `PaymentPostCommitHooks.getSystemUserId()`
   * (payment-post-commit-hooks.ts:215) — ไม่ใช่ email `admin@bestchoice.com` แบบ
   * journal-auto.service.ts/bookings.service.ts ซึ่งชี้พนักงานจริงคนหนึ่ง คนละความหมายกับ "ระบบ".
   * Cache ต่อ process (ตาม pattern resolveFinanceCompanyId/resolveSystemUserId ของ
   * journal-auto.service.ts) — resolve ไม่เจอ = คืน null แล้วให้ caller ข้าม audit ไปเลย
   * (ห้ามปล่อยให้ FK พังเงียบใน AuditService.log ต่อ).
   */
  private async resolveSystemActorUserId(): Promise<string | null> {
    if (this.systemUserId) return this.systemUserId;
    try {
      const user = await this.prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
      if (!user) {
        this.logger.error('[prospect] system user (isSystemUser=true) not found — skipping merge audit');
        Sentry.captureException(new Error('System user not found for chat-prospect merge audit'), {
          tags: { kind: 'chat-prospect' },
        });
        return null;
      }
      this.systemUserId = user.id;
      return user.id;
    } catch (err) {
      this.logger.error(`[prospect] failed to resolve system user id: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'chat-prospect' } });
      return null;
    }
  }

  /**
   * Ruling R26 (I6) — ปุ่ม "รวมเข้าลูกค้าเดิม" ของ SALES ต้องไม่หลวมกว่าทางผูกห้อง: การรวม **ย้ายห้อง
   * ทุกห้อง** ของผู้สนใจคนนั้น ⇒ SALES ที่ไม่ได้ดูแลห้องต้องรวมไม่ได้ (กติกาเดียวกับ
   * RoomManagerService.linkCustomer และ dismiss คำใบ้ — R19)
   * เรียกจาก endpoint `/customers/:id/absorb-into/:targetId` และ `/customers/:id/fill-contact` —
   * ผู้เรียกอื่น (OTP / LIFF / ผูกห้อง / รวมห้องแชท) มีด่านของตัวเองอยู่แล้ว พฤติกรรมไม่เปลี่ยน
   *
   * M-A2 — ข้อความ 403 ต่างจาก linkCustomer/dismiss โดยตั้งใจ: ด่านนี้ถูกชนจากหน้าลูกค้า
   * (ปุ่ม "เติมเบอร์") และจากข้อความ "ยังไม่มีเบอร์" ของการเปิดเอกสาร ซึ่งไม่มีห้องแชทให้เห็น —
   * "ไม่มีสิทธิ์เข้าถึงห้องแชทนี้" ลอย ๆ เป็นทางตัน จึงบอกว่าใครทำแทนได้: คนดูแลห้อง หรือ role ที่
   * ข้ามด่านนี้ (OWNER/BRANCH_MANAGER/FINANCE_MANAGER = @Roles ของสองเส้นทางข้างบนที่ไม่ใช่ SALES)
   */
  async assertActorMayAbsorb(placeholderId: string, actor: MergeActor): Promise<void> {
    if (actor.role !== 'SALES') return;
    const held = await this.prisma.chatRoom.findFirst({
      where: {
        customerId: placeholderId,
        deletedAt: null,
        // แยกเป็นสองเงื่อนไขใน AND: `{ not: actor.id }` เดี่ยว ๆ ตัดแถว assignedToId = NULL ทิ้งด้วย (SQL 3VL)
        AND: [{ assignedToId: { not: null } }, { assignedToId: { not: actor.id } }],
      },
      select: { id: true },
    });
    if (held) {
      throw new ForbiddenException(
        'ห้องแชทของผู้สนใจคนนี้มีพนักงานคนอื่นดูแลอยู่ — ให้คนดูแลห้อง หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน เติมเบอร์หรือรวมให้',
      );
    }
  }

  async absorbPlaceholder(
    placeholderId: string,
    targetId: string,
    actor: MergeActor,
    opts: { allowPlaceholderTarget?: boolean } = {},
  ): Promise<AbsorbResult> {
    if (placeholderId === targetId) throw new BadRequestException('รวมกับตัวเองไม่ได้');
    const { result, roomIds, sourceCopied } = await this.prisma.$transaction(async (tx) => {
      // ล็อกทั้งสองฝั่งเรียงตาม id กัน deadlock กับ absorb สวนทาง
      for (const id of [placeholderId, targetId].sort()) await lockCreditCustomer(tx, id);
      const [placeholder, target] = await Promise.all([
        tx.customer.findUnique({
          where: { id: placeholderId },
          select: { id: true, ...PLACEHOLDER_FIELDS_SELECT, ...SOURCE_COPY_SELECT, _count: { select: COUNT_SELECT } },
        }),
        tx.customer.findUnique({
          where: { id: targetId },
          select: { id: true, ...PLACEHOLDER_FIELDS_SELECT, ...SOURCE_COPY_SELECT },
        }),
      ]);
      // แยก 404 (ไม่พบ/ถูกลบ) ออกจาก 409 (ไม่ใช่ placeholder) จึงไม่ใช้ isLivePlaceholder ตรงนี้
      if (!placeholder || placeholder.deletedAt) throw new NotFoundException('ไม่พบผู้สนใจที่จะรวม');
      if (!target || target.deletedAt) throw new NotFoundException('ไม่พบลูกค้าปลายทาง');
      if (!isChatPlaceholder(placeholder)) {
        throw new ConflictException('รวมได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์และเลขบัตร');
      }
      if (isChatPlaceholder(target) && !opts.allowPlaceholderTarget) {
        throw new ConflictException('ปลายทางต้องเป็นลูกค้าหรือผู้สนใจที่มีเบอร์แล้ว — ผู้สนใจอัตโนมัติสองคนให้ใช้ "รวมห้องแชท"');
      }
      const blocking = (Object.keys(BLOCKING_RELATIONS) as BlockingKey[]).filter((k) => placeholder._count[k] > 0);
      if (blocking.length > 0) {
        const detail = blocking.map((k) => `${BLOCKING_RELATIONS[k]} ${placeholder._count[k]} รายการ`).join(', ');
        throw new ConflictException(`รวมไม่ได้: ผู้สนใจคนนี้มี${detail} — ให้แก้ที่รายการนั้นก่อน`);
      }

      const rooms = await tx.chatRoom.findMany({ where: { customerId: placeholderId }, select: { id: true } });
      const movedRooms = (await tx.chatRoom.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } })).count;
      const movedCreditChecks = (await tx.creditCheck.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } })).count;

      // แท็ก: unique [customerId, tag, deletedAt] — ที่ปลายทางมีแล้ว soft-delete แทนย้าย
      const targetTags = new Set(
        (await tx.customerTag.findMany({ where: { customerId: targetId, deletedAt: null }, select: { tag: true } })).map((t) => t.tag),
      );
      const tags = await tx.customerTag.findMany({ where: { customerId: placeholderId, deletedAt: null }, select: { id: true, tag: true } });
      for (const tag of tags) {
        await tx.customerTag.update({
          where: { id: tag.id },
          data: targetTags.has(tag.tag) ? { deletedAt: new Date() } : { customerId: targetId },
        });
      }

      await tx.crmLead.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });
      await tx.adsAttribution.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });

      // การเดินทางของลูกค้า — ล็อกสองฝั่งแล้วข้างบน
      // (1) บันทึกของ placeholder ย้ายตามเจ้าของ · originCustomerId คงเดิม · dedupeKey ผูกกับเอกสาร ไม่ผูกลูกค้า จึงไม่ชน unique
      await tx.customerJourneyEntry.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });
      // (2) ยุบ chain: คนที่เคยถูกรวมเข้า placeholder ตัวนี้ (รวมห้องแชท placeholder→placeholder) ชี้ไปปลายทางใหม่
      //     ⇒ ตัวอ่านหา ids ได้ชั้นเดียวเสมอ: [customerId, ...customers.where({ mergedIntoId: customerId })]
      await tx.customer.updateMany({ where: { mergedIntoId: placeholderId }, data: { mergedIntoId: targetId } });
      // (4) แช่แข็งจุดเริ่มต้นของการเดินทางลงแคชของปลายทาง — ไม่ขึ้นกับ R24 ข้างล่าง (R24 ยกเฉพาะ acquisitionSource ที่ปลายทางยังว่าง)
      await this.freezeJourneyOrigin(tx, placeholderId, targetId);

      // trigger: unique [customerId, referenceKey] (รวมแถวที่ soft-delete แล้ว) — ตรวจชนก่อน
      // ห้ามใช้ try/catch จับ unique violation ใน tx (Postgres ยกเลิกทั้งทรานแซกชันเมื่อ statement ล้ม)
      const targetKeys = new Set(
        (await tx.chatAutoTrigger.findMany({ where: { customerId: targetId }, select: { referenceKey: true } })).map((t) => t.referenceKey),
      );
      const triggers = await tx.chatAutoTrigger.findMany({ where: { customerId: placeholderId }, select: { id: true, referenceKey: true } });
      for (const trigger of triggers) {
        if (targetKeys.has(trigger.referenceKey)) await tx.chatAutoTrigger.delete({ where: { id: trigger.id } });
        else await tx.chatAutoTrigger.update({ where: { id: trigger.id }, data: { customerId: targetId } });
      }
      await tx.customerScore.deleteMany({ where: { customerId: placeholderId } });

      const targetPatch: Prisma.CustomerUpdateInput = {};
      if (target.creditCheckStatus === 'NONE' && placeholder.creditCheckStatus !== 'NONE') {
        targetPatch.creditCheckStatus = placeholder.creditCheckStatus;
      }
      // Ruling R24 (แก้สเปค §3.3) — ยกที่มา CHAT_* ไปให้ปลายทางเมื่อ "ทักมาก่อนแล้วค่อยซื้อ":
      // ลูกค้าที่พนักงานสร้างจากกล่องข้อความไม่เคยมี acquisitionSource (CreateCustomerDto ไม่มีช่องนี้)
      // ⇒ ถ้าไม่ยก KPI "มาจากแชท" จะไม่นับคนกลุ่มนี้เลย ทั้งที่เป็นเส้นทางหลักของอินบ็อกซ์
      // เงื่อนไข: ปลายทางยังไม่มีที่มา **และ** ผู้สนใจเกิดก่อน/พร้อมกัน (ซื้อก่อนแล้วผูกห้องทีหลัง = ไม่ยก)
      // ห้ามทับค่าที่ปลายทางมีอยู่แล้วทุกช่อง
      const sourceCopied =
        target.acquisitionSource == null &&
        placeholder.acquisitionSource != null &&
        placeholder.createdAt <= target.createdAt;
      if (sourceCopied) {
        targetPatch.acquisitionSource = placeholder.acquisitionSource;
        if (target.facebookUserId == null && placeholder.facebookUserId != null) {
          targetPatch.facebookUserId = placeholder.facebookUserId;
        }
        if (target.facebookName == null && placeholder.facebookName != null) {
          targetPatch.facebookName = placeholder.facebookName;
        }
      }
      if (Object.keys(targetPatch).length > 0) {
        await tx.customer.update({ where: { id: targetId }, data: targetPatch });
      }
      const mergedAt = new Date();
      // (3) merged_into_id คู่ deletedAt — ลิงก์เก่าที่ชี้ placeholder ตามไปหาลูกค้าจริงได้
      await tx.customer.update({ where: { id: placeholderId }, data: { deletedAt: mergedAt, mergedIntoId: targetId } });
      // (5) PLACEHOLDER_MERGED เขียนใน tx เดียวกับการรวม (ต่างจาก audit ที่ลงหลัง commit) — actorUserId เป็น null ได้
      //     จึงไม่ติด FK และไม่ถูกข้ามแบบ audit R12 · ล้มตรงไหน = rollback พร้อมกันทั้งใบ
      //     data มีแค่จำนวนห้อง — ห้ามใส่ข้อความแชท / เบอร์ / เลขบัตร / ที่อยู่ (PDPA)
      await this.journeyEntries.recordInTx(tx, {
        customerId: targetId,
        kind: 'PLACEHOLDER_MERGED',
        occurredAt: mergedAt,
        actorType: actor.role === 'SYSTEM' ? 'SYSTEM' : 'STAFF',
        actorUserId: actor.role === 'SYSTEM' ? null : actor.id,
        data: { roomCount: rooms.length },
        dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', placeholderId),
      });

      return {
        result: { placeholderId, targetId, movedRooms, movedCreditChecks },
        roomIds: rooms.map((r) => r.id),
        sourceCopied,
      };
    });

    // audit หลัง commit เท่านั้น — AuditService.log เปิดทรานแซกชันของตัวเอง (คนละ connection)
    // ถ้าเขียนใน tx ข้างบนแล้ว commit ล้ม จะเหลือ audit ของการรวมที่ไม่เกิดขึ้นจริง
    // Ruling R12 — actor SYSTEM ต้อง resolve เป็น userId จริงก่อนเขียน (ดู resolveSystemActorUserId)
    // resolve ไม่เจอ = ข้าม audit ทั้งใบ ไม่ปล่อยให้ FK พังเงียบใน AuditService.log
    const auditUserId = actor.role === 'SYSTEM' ? await this.resolveSystemActorUserId() : actor.id;
    if (auditUserId) {
      await this.audit.log({
        userId: auditUserId,
        action: 'CUSTOMER_PLACEHOLDER_MERGED',
        entity: 'customer',
        entityId: targetId,
        oldValue: { placeholderId },
        newValue: { roomIds, movedCreditChecks: result.movedCreditChecks, sourceCopied },
      });
    } else {
      this.logger.warn(
        `[merge] skipped audit for placeholder ${placeholderId} → ${targetId} — could not resolve system actor user id`,
      );
    }
    // (6) แคชสรุปคำนวณใหม่หลัง commit — ส่ง placeholderId ด้วย เพื่อเก็บแถวแคชที่ cron อาจเขียนแทรกระหว่างทรานแซกชัน
    //     ล้มแล้วการรวมไม่ล้ม: summary endpoint ตรวจสดแล้วคำนวณใหม่ในคำขอ + cron journey:recompute คืนนั้นซ่อมเอง (Plan 2 Task 9)
    try {
      await this.journeyState.recompute([targetId, placeholderId]);
    } catch (err) {
      this.logger.warn(`[merge] journey recompute failed for ${targetId}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'customer-journey' } });
    }
    this.logger.log(
      `[merge] placeholder ${placeholderId} → ${targetId} rooms=${result.movedRooms} creditChecks=${result.movedCreditChecks} by ${actor.id}`,
    );
    return result;
  }

  /**
   * (4) แช่แข็งจุดเริ่มต้นของการเดินทาง — contactedAt / firstChannel / firstSource / firstAdCampaignId เป็นค่าแช่แข็ง
   * (recompute เลือกได้แค่ค่าที่เก่ากว่า) · placeholder ทักมาก่อน ⇒ ปลายทางรับชุดจุดเริ่มต้นของ placeholder ทั้งชุด
   * ปลายทางยังไม่มีแคช ⇒ สร้างจากแถวของ placeholder (stage/path ถูกแก้โดย recompute หลัง commit)
   * แคชของ placeholder ถูกลบเสมอ — ลูกค้าที่ถูกรวมแล้วไม่มีแคชของตัวเอง
   */
  private async freezeJourneyOrigin(tx: Prisma.TransactionClient, placeholderId: string, targetId: string): Promise<void> {
    const [from, into] = await Promise.all([
      tx.customerJourneyState.findUnique({ where: { customerId: placeholderId } }),
      tx.customerJourneyState.findUnique({ where: { customerId: targetId } }),
    ]);
    const freezeTarget = async () => {
      if (!from || (into && from.contactedAt >= into.contactedAt)) return;
      const origin = {
        contactedAt: from.contactedAt,
        firstChannel: from.firstChannel,
        firstSource: from.firstSource,
        firstAdCampaignId: from.firstAdCampaignId,
        firstStaffReplyAt: earliest(from.firstStaffReplyAt, into?.firstStaffReplyAt ?? null),
      };
      await tx.customerJourneyState.upsert({
        where: { customerId: targetId },
        update: origin,
        create: {
          customerId: targetId,
          stage: from.stage,
          stageEnteredAt: from.stageEnteredAt,
          path: from.path,
          computedAt: from.computedAt,
          ...origin,
        },
      });
    };
    // เขียนแถวแคชทั้งสองเรียงตาม customer_id — ลำดับเดียวกับ INSERT … ORDER BY ของ journey-state.sql
    // และ lockCreditCustomer ข้างบน ⇒ recompute ที่วิ่งพร้อมกัน (cron/CLI/summary) ไม่ deadlock กับการรวม
    for (const id of [placeholderId, targetId].sort()) {
      if (id === targetId) await freezeTarget();
      else await tx.customerJourneyState.deleteMany({ where: { customerId: placeholderId } });
    }
  }

  /**
   * LINE ถูกผูกกับลูกค้า (OTP บอทการเงิน / พิมพ์เบอร์ใน LINE ร้าน / LIFF) → ห้อง LINE ของคนนั้น
   * ที่ยังถือ placeholder ต้องถูกดูดเข้าลูกค้าจริง ห้องที่ไม่มีเจ้าของผูกตรง (สเปค 3.3 ง)
   * ห้องที่ผูกกับลูกค้าจริงคนอื่นอยู่แล้ว (ไม่ใช่ placeholder) ถูกข้ามไปเฉยๆ — ไม่ทับประวัติ
   */
  async absorbRoomsOfLineUser(
    lineUserId: string,
    channel: 'LINE_SHOP' | 'LINE_FINANCE',
    customerId: string,
    actor: MergeActor,
  ): Promise<{ absorbed: number; linked: number }> {
    const rooms = await this.prisma.chatRoom.findMany({
      where: { lineUserId, channel, deletedAt: null },
      select: { id: true, customerId: true, customer: { select: PLACEHOLDER_FIELDS_SELECT } },
    });
    let absorbed = 0;
    let linked = 0;
    const absorbedIds = new Set<string>();
    for (const room of rooms) {
      if (!room.customerId) {
        await this.prisma.chatRoom.update({ where: { id: room.id }, data: { customerId } });
        linked++;
      } else if (room.customerId !== customerId && !absorbedIds.has(room.customerId) && isLivePlaceholder(room.customer)) {
        await this.absorbPlaceholder(room.customerId, customerId, actor);
        absorbedIds.add(room.customerId);
        absorbed++;
      }
    }
    return { absorbed, linked };
  }
}
