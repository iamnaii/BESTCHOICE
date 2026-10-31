import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BubbleTranslatorService, Bubble, QuickReply } from './bubble-translator.service';
import { CannedResponseVariableService } from './canned-response-variable.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { findOtpVerifiedCustomerId } from '../../line-oa/services/otp-verified-customer';

/** ตัวแปรที่เปิดเผยข้อมูลของลูกค้า — ลูกค้าเป็นคนกดปุ่ม (staffId = null) ได้ค่าจริงเฉพาะ LINE ที่ยืนยัน OTP แล้ว (Task 22 I-C) */
const CUSTOMER_VARIABLE_PLACEHOLDERS: Record<string, string> = {
  customerName: 'ลูกค้า',
  customerPhone: '-',
  contractNumber: '-',
  amountDue: '-',
  dueDate: '-',
  installmentNo: '-',
};

/**
 * CannedResponseSenderService — orchestrates the Phase 4 multi-bubble send.
 *
 * Pipeline:
 *   1. Resolve the room and external user ID
 *   2. Load the canned-response template with bubbles + quick replies
 *   3. Enforce verifiedOnly gate
 *   4. Filter bubbles by the room's channel
 *   5. Expand variables in TEXT bubbles via CannedResponseVariableService
 *   6. Translate to OutboundMessage[] and attach quick replies to the LAST one
 *   7. Dispatch through MessageRouterService.sendStaffOutbound sequentially
 *      (preserves bubble order; adapter rate limits still apply per call)
 *
 * Task 22 I-C — ลูกค้าเป็นคนกดปุ่ม quick reply (postback `TEMPLATE:` → `staffId = null`): ตัวแปรลูกค้า
 * (`{customerName}` `{customerPhone}` `{contractNumber}` `{amountDue}` `{dueDate}` `{installmentNo}`) เติมค่าจริง
 * **เฉพาะ** ห้อง LINE ที่ `findOtpVerifiedCustomerId(room.lineUserId) === room.customerId` — `chat_rooms.customer_id`
 * ของห้อง LINE ร้าน/Facebook ถูกบอทขาย (`capture_lead` `LINKED_BY_PHONE`) ผูกได้ด้วยเบอร์อย่างเดียว ⇒ ผู้ใช้ที่บอกเบอร์ของคนอื่น
 * แล้วกดปุ่มจะได้ชื่อ/สัญญา/ยอดของเจ้าของเบอร์. ไม่ผ่าน (รวม Facebook ซึ่งไม่มีทางยืนยัน OTP) = คำกลาง
 * (`CUSTOMER_VARIABLE_PLACEHOLDERS`) · `{branchName}` (สาขาของพนักงานที่ดูแลห้อง) ไม่ใช่ข้อมูลลูกค้า เติมตามเดิม ·
 * พนักงานกดส่งเอง (`staffId` มีค่า) ใช้ลูกค้าของห้องตามเดิม — พนักงานเห็นห้องและตัดสินเอง
 */
@Injectable()
export class CannedResponseSenderService {
  private readonly logger = new Logger(CannedResponseSenderService.name);

  constructor(
    private prisma: PrismaService,
    private translator: BubbleTranslatorService,
    private variableService: CannedResponseVariableService,
    private messageRouter: MessageRouterService,
  ) {}

  /**
   * Lazily bootstrap (or fetch) the system bot user used when a send is
   * initiated by an automated path (e.g. Quick Reply postback router) rather
   * than a real staff member. Idempotent — `upsert` is atomic at the DB
   * level so concurrent first-time postbacks cannot race (Postgres handles
   * the unique-email constraint internally, eliminating the P2002 window
   * that `findFirst` → `create` had).
   *
   * The system user is marked `isActive=false` so it cannot log in via the
   * normal auth flow; its password placeholder is intentionally unusable.
   *
   * Role is `SALES` (lowest practical role) — the bot must NOT appear in
   * OWNER-only queries (audit recipients, role-filtered admin lists, etc.).
   * Matches the existing `collections-foundation.seed` row whose update
   * path also keeps it in the system-user pool; if the seed has already
   * created an `OWNER`-role row, the `update: {}` no-op preserves it
   * (only first-ever create stamps `SALES`).
   */
  private async getSystemUserId(): Promise<string> {
    const user = await this.prisma.user.upsert({
      where: { email: 'system@bestchoice.internal' },
      update: {},
      create: {
        email: 'system@bestchoice.internal',
        password: 'NEVER_LOGIN_SYSTEM_USER',
        name: 'System Bot',
        role: 'SALES',
        // ค่าคงที่ ไม่ derive จาก role โดยตั้งใจ — แถวนี้ถูกแย่งสร้างโดยสองที่ด้วย role
        // ต่างกัน (ที่นี่ SALES, collections-foundation.seed OWNER) และทั้งคู่ `update: {}`
        // เป็น no-op ⇒ ใครสร้างก่อนได้ role นั้นถาวร การ hardcode ค่าเดียวกันทั้งสองที่
        // ทำให้ผลของ race ไม่ต่างกัน (backfill CLI ก็ข้ามแถว isSystemUser ด้วยเหตุนี้)
        accessibleCompanies: ['SHOP', 'FINANCE'],
        primaryCompany: 'SHOP',
        isActive: false,
        isSystemUser: true,
      },
      select: { id: true },
    });
    return user.id;
  }

  /** ลูกค้าของห้องเมื่อ LINE ของห้องยืนยัน OTP กับลูกค้าคนนั้นแล้ว — ไม่ใช่ห้อง LINE / ยังไม่ยืนยัน / ยืนยันกับคนอื่น = undefined */
  private async otpVerifiedRoomCustomerId(room: {
    lineUserId: string | null;
    customerId: string | null;
  }): Promise<string | undefined> {
    if (!room.lineUserId || !room.customerId) return undefined;
    const verified = await findOtpVerifiedCustomerId(this.prisma, room.lineUserId);
    return verified === room.customerId ? verified : undefined;
  }

  async send(
    roomId: string,
    templateId: string,
    staffId: string | null,
  ): Promise<{ sent: number; dropped: number; errors: string[] }> {
    const effectiveStaffId = staffId ?? (await this.getSystemUserId());
    // 1. Resolve room
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        externalUserId: true,
        lineUserId: true,
        customerId: true,
        verifiedAt: true,
      },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');

    const externalUserId = room.externalUserId ?? room.lineUserId;
    if (!externalUserId) {
      throw new BadRequestException('ห้องไม่มี externalUserId/lineUserId — ไม่สามารถส่งได้');
    }

    // 2. Load template
    const template = await this.prisma.cannedResponse.findFirst({
      where: { id: templateId, deletedAt: null, isActive: true },
      include: {
        bubbles: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        quickReplies: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!template) throw new NotFoundException('ไม่พบ template');

    // 3. verifiedOnly gate
    if (template.verifiedOnly && !room.verifiedAt) {
      throw new BadRequestException('Template นี้ใช้ได้เฉพาะลูกค้าที่ยืนยันตัวตนแล้ว');
    }

    // 4. Filter by channel
    const allBubbles = template.bubbles as unknown as Bubble[];
    const applicableBubbles = this.translator.filterByChannel(allBubbles, room.channel);
    if (applicableBubbles.length === 0) {
      throw new BadRequestException('ไม่มี bubble ที่ใช้กับ channel นี้');
    }

    // 5. Expand variables in TEXT bubbles.
    //
    // To avoid N+1 DB queries (each expandVariables call hits customer +
    // contract + payment + chatRoom), resolve every supported variable
    // ONCE via a probe string, build a substitution map, then apply it
    // locally to each TEXT bubble.
    //
    // The probe uses the ASCII SOH control char (U+0001) as a delimiter
    // that the variable service's final `result.replace(/\{(\w+)\}/g, ...)`
    // preserves verbatim — only `{name}` tokens are substituted, the
    // separator passes through unchanged. SOH was chosen because it
    // cannot appear in any user-facing value (name, phone, amount, etc.).
    const VARIABLE_KEYS = [
      'customerName',
      'customerPhone',
      'contractNumber',
      'amountDue',
      'dueDate',
      'installmentNo',
      'branchName',
    ] as const;
    const SEP = ''; // unlikely to appear in any resolved value
    const probe = VARIABLE_KEYS.map((k) => `{${k}}`).join(SEP);
    // Task 22 I-C — ลูกค้ากดเอง: ข้อมูลลูกค้าเฉพาะห้อง LINE ที่ยืนยัน OTP กับลูกค้าของห้องแล้ว
    const variableCustomerId =
      staffId === null
        ? await this.otpVerifiedRoomCustomerId(room)
        : (room.customerId ?? undefined);
    const expandedProbe = await this.variableService.expandVariables(probe, {
      roomId,
      customerId: variableCustomerId,
    });
    const resolvedParts = expandedProbe.split(SEP);
    const resolvedValues: Record<string, string> = {};
    VARIABLE_KEYS.forEach((k, i) => {
      resolvedValues[k] = resolvedParts[i] ?? '-';
    });
    if (!variableCustomerId) Object.assign(resolvedValues, CUSTOMER_VARIABLE_PLACEHOLDERS);

    const expandedBubbles = applicableBubbles.map((b) => {
      if (b.type === 'TEXT' && b.text) {
        const text = b.text.replace(
          /\{(\w+)\}/g,
          (_match, key: string) => resolvedValues[key] ?? '-',
        );
        return { ...b, text };
      }
      return b;
    });

    // 6. Translate to OutboundMessage[] and attach quick replies to LAST one
    const quickReplies = this.translator.translateQuickReplies(
      template.quickReplies as unknown as QuickReply[],
    );
    const outbound = expandedBubbles.map((b) =>
      this.translator.toOutboundMessage(b, externalUserId),
    );
    if (quickReplies.length > 0 && outbound.length > 0) {
      outbound[outbound.length - 1].quickReplies = quickReplies;
    }

    // 7. Sequential dispatch — preserves bubble order, surfaces per-message status
    let sent = 0;
    let dropped = 0;
    const errors: string[] = [];

    for (const msg of outbound) {
      try {
        const result = await this.messageRouter.sendStaffOutbound(roomId, msg, effectiveStaffId);
        if (result.success) {
          if (result.droppedReason) {
            dropped++;
          } else {
            sent++;
          }
        } else {
          errors.push(result.error ?? 'unknown adapter error');
        }
      } catch (err) {
        const msgErr = err instanceof Error ? err.message : String(err);
        errors.push(msgErr);
        this.logger.error(`Failed to send bubble: ${msgErr}`);
      }
    }

    return { sent, dropped, errors };
  }
}
