import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';
import { PLACEHOLDER_FIELDS_SELECT, isChatPlaceholder } from './chat-placeholder';

export interface MergeActor { id: string; role: string }
export interface AbsorbResult { placeholderId: string; targetId: string; movedRooms: number; movedCreditChecks: number }

/** relation ที่ placeholder ห้ามมี (สเปค 3.3) — ชื่อ relation ใน Prisma → ป้ายไทยในข้อความ 409 */
const BLOCKING_RELATIONS = {
  contracts: 'สัญญา', sales: 'ใบขาย', bookings: 'ใบจอง', reservations: 'การจองสินค้า', tradeIns: 'รายการรับซื้อ',
  onlineOrders: 'คำสั่งซื้อออนไลน์', savingPlans: 'แผนออม', onlineApplications: 'ใบสมัครผ่อนออนไลน์',
  loyaltyPoints: 'แต้มสะสม', loyaltyRedemptions: 'การแลกแต้ม', promotionUsages: 'การใช้โปรโมชัน', repairTickets: 'ใบซ่อม',
  otherIncomes: 'รายได้อื่น', partialPaymentLinks: 'ลิงก์ชำระบางส่วน', kycVerifications: 'การยืนยันตัวตน',
  pdpaConsents: 'ความยินยอม PDPA', dsarRequests: 'คำขอ PDPA', lineLinks: 'การผูก LINE', referrals: 'คนที่แนะนำมา',
  reviews: 'รีวิว', creditApprovals: 'ผลอนุมัติเครดิต', websiteVisits: 'การเข้าเว็บ', websiteSessions: 'เซสชันเว็บ',
} as const;
type BlockingKey = keyof typeof BLOCKING_RELATIONS;
const COUNT_SELECT = Object.fromEntries(Object.keys(BLOCKING_RELATIONS).map((k) => [k, true])) as Record<BlockingKey, true>;

/**
 * รวม "ผู้สนใจอัตโนมัติจากแชท" เข้าลูกค้าตัวจริง — ทางเดียว ไม่ใช่ merge ลูกค้าทั่วไป
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.3)
 * ย้ายเฉพาะ: ห้องแชท · CreditCheck ที่ import จากห้อง (updateMany ตรง — linkRoomCreditHistory ย้ายเฉพาะ
 * ผลที่ยังไม่ import) · แท็ก · crmLeads · adsAttributions · chatAutoTriggers · แล้ว soft-delete placeholder
 */
@Injectable()
export class CustomerMergeService {
  private readonly logger = new Logger(CustomerMergeService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async absorbPlaceholder(
    placeholderId: string,
    targetId: string,
    actor: MergeActor,
    opts: { allowPlaceholderTarget?: boolean } = {},
  ): Promise<AbsorbResult> {
    if (placeholderId === targetId) throw new BadRequestException('รวมกับตัวเองไม่ได้');
    const { result, roomIds } = await this.prisma.$transaction(async (tx) => {
      // ล็อกทั้งสองฝั่งเรียงตาม id กัน deadlock กับ absorb สวนทาง
      for (const id of [placeholderId, targetId].sort()) await lockCreditCustomer(tx, id);
      const [placeholder, target] = await Promise.all([
        tx.customer.findUnique({
          where: { id: placeholderId },
          select: { id: true, ...PLACEHOLDER_FIELDS_SELECT, creditCheckStatus: true, _count: { select: COUNT_SELECT } },
        }),
        tx.customer.findUnique({
          where: { id: targetId },
          select: { id: true, ...PLACEHOLDER_FIELDS_SELECT, creditCheckStatus: true },
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

      if (target.creditCheckStatus === 'NONE' && placeholder.creditCheckStatus !== 'NONE') {
        await tx.customer.update({ where: { id: targetId }, data: { creditCheckStatus: placeholder.creditCheckStatus } });
      }
      await tx.customer.update({ where: { id: placeholderId }, data: { deletedAt: new Date() } });

      return {
        result: { placeholderId, targetId, movedRooms, movedCreditChecks },
        roomIds: rooms.map((r) => r.id),
      };
    });

    // audit หลัง commit เท่านั้น — AuditService.log เปิดทรานแซกชันของตัวเอง (คนละ connection)
    // ถ้าเขียนใน tx ข้างบนแล้ว commit ล้ม จะเหลือ audit ของการรวมที่ไม่เกิดขึ้นจริง
    await this.audit.log({
      userId: actor.id,
      action: 'CUSTOMER_PLACEHOLDER_MERGED',
      entity: 'customer',
      entityId: targetId,
      oldValue: { placeholderId },
      newValue: { roomIds, movedCreditChecks: result.movedCreditChecks },
    });
    this.logger.log(
      `[merge] placeholder ${placeholderId} → ${targetId} rooms=${result.movedRooms} creditChecks=${result.movedCreditChecks} by ${actor.id}`,
    );
    return result;
  }
}
