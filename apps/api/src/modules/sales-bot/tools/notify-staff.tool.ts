import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ChatPriority } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CHAT_GATEWAY_TOKEN,
  IChatGateway,
} from '../../chat-engine/interfaces/chat-gateway.interface';
import {
  BOT_STAFF_ATTENTION_PREFIX,
  hasPendingBotStaffAttention,
} from '../../chat-engine/constants/bot-staff-attention';

/**
 * ปักธงให้พนักงานตามต่อ "โดยบอทยังตอบห้องนี้ต่อ" (เจ้าของสั่ง 2026-09-22: โหมดไม่มีสต๊อก — ลูกค้าขอดูรูป
 * เครื่องจริง/สี/แบต → บอกว่าแอดมินจะส่งรูปให้ + เรียกพนักงาน · และงานบริการของลูกค้าที่มีสัญญาแล้ว)
 *
 * ต่างจาก handoff_to_human: handoff = "บอทตอบไม่ได้" (confidence 0.3 → router ทิ้งคำตอบ ส่งประโยคกลาง
 * แล้วตั้ง handoffMode = บอทเงียบทั้งห้องจนพนักงานปลด) ส่วนตัวนี้ = บอทตอบได้แล้ว แค่ต้องให้คนทำสิ่งที่
 * บอททำเองไม่ได้ (ส่งรูปเครื่องจริง/เช็คราคาสด/เช็คสัญญา) ⇒ ไม่ลด confidence และ **ไม่ตั้ง handoffMode**
 * — เดิมใช้ตัวปักธงของ handoff (handoffMode = true) ⇒ ลูกค้าถามต่อหรือกดปุ่มที่บอทเพิ่งเสนอ บอทเงียบ
 * จนพนักงานปลด (นอกเวลาทำการ = ถึง 10 โมง — รีวิว ROUTER-1 / TOOLLOOP-5 / PROMPT-1 2026-09-22)
 * พนักงานตอบเองเมื่อไร echo ของข้อความพนักงานหยุด AI ของห้องตามกลไกเดิม (aiPaused)
 *
 * สิ่งที่พนักงานเห็นในกล่องแชท (ไม่ต้องแก้หน้าจอ):
 * - ป้าย "ด่วน" ที่แถวรายชื่อห้อง (priority LOW/NORMAL → HIGH — ไม่ลดห้องที่ CRITICAL อยู่แล้ว)
 * - รายการห้องรีเฟรชทันทีผ่าน chat:room:update
 * - handoffReason = "[บอทขอให้พนักงานตามต่อ] <เหตุผล>" + handoffTaggedAt (บันทึกไว้ให้ป้ายเฉพาะในอนาคต/รายงาน)
 * ห้องอยู่แท็บ "รอตอบ" อยู่แล้ว (waitingSince ไม่ถูกล้างด้วยคำตอบของบอท)
 * prefix ของเหตุผลมาจาก chat-engine/constants/bot-staff-attention (แหล่งเดียว — HandoffManager/ด่านโควต้า
 * อ่านค่าเดียวกันเพื่อต่อท้ายคำขอนี้แทนการเขียนทับ)
 *
 * ⚠️ ป้าย "ด่วน" ยังไม่มีใครลดกลับ (พนักงานตอบ/ปิดงานแล้วก็ยังค้าง) — ต้องแก้ฝั่ง chat-engine หรือหน้าจอ
 * (รีวิว SB-V1 · รายละเอียดใน openQuestions ของรอบ 2026-09-22) ไม่ใช่ที่เครื่องมือนี้
 */
export const NOTIFY_STAFF_REASON_PREFIX = BOT_STAFF_ATTENTION_PREFIX;
/** ความยาวสูงสุดของส่วนเหตุผล (ไม่รวม prefix) — ทั้งเหตุผลเดี่ยวและเมื่อต่อท้ายคำขอเดิม */
export const NOTIFY_STAFF_REASON_MAX = 300;
const REASON_SEPARATOR = ' · ';

/**
 * เหตุผลที่จะบันทึก — ห้องยังค้างคำขอเดิมของบอท (≤24 ชม. ตาม hasPendingBotStaffAttention) = ต่อท้าย ไม่เขียนทับ
 * (เดิมคำขอที่สองทับคำขอแรก เช่น "ขอดูรูป iPhone 15" หายเพราะ "ขอราคาเงินสด" — รีวิว SB-V5) · เรื่องซ้ำ = ย้ายไปท้าย
 * ไม่เพิ่มซ้ำ · ยาวเกินเพดาน = ทิ้งคำขอเก่าสุดก่อน (คำขอล่าสุดอยู่เสมอ)
 */
export function mergeNotifyStaffReason(
  reason: string,
  room:
    | { handoffMode?: boolean | null; handoffReason?: string | null; handoffTaggedAt?: Date | null }
    | null
    | undefined,
  now: Date = new Date(),
): string {
  let items = [reason];
  if (hasPendingBotStaffAttention(room, now)) {
    const previous = room!
      .handoffReason!.trim()
      .slice(NOTIFY_STAFF_REASON_PREFIX.length)
      .split(REASON_SEPARATOR)
      .map((r) => r.trim())
      .filter((r) => r && r !== reason);
    items = [...previous, reason];
  }
  while (items.length > 1 && items.join(REASON_SEPARATOR).length > NOTIFY_STAFF_REASON_MAX) {
    items.shift();
  }
  return `${NOTIFY_STAFF_REASON_PREFIX} ${items.join(REASON_SEPARATOR)}`;
}

export const NOTIFY_STAFF_TOOL = {
  name: 'notify_staff',
  description:
    'ปักธง "ด่วน" ให้พนักงานตามเรื่องในห้องนี้ — บอทยังตอบห้องนี้ต่อได้ตามปกติ (ไม่ได้ส่งต่อทั้งห้อง) และข้อความที่คุณตอบลูกค้า' +
    'ในเทิร์นนี้ยังส่งตามปกติ. ใช้เฉพาะ: (1) จุดที่ persona หรือหัวข้อโหมดไม่มีสต๊อกสั่งให้เรียก (เช่น รูปเครื่องจริง/สี/แบต/สภาพ ' +
    'ขอราคาเงินสด รุ่นที่ยังไม่มีในตารางเรท) (2) งานบริการของลูกค้าที่มีสัญญาอยู่แล้ว: ส่งสลิป/แจ้งโอนค่างวด เช็คยอดหรือวันครบกำหนด ' +
    'เครื่องโดนล็อก/ขอปลดล็อก แอปธนาคารเข้าไม่ได้ ขอเลื่อนงวด ขอผ่อนเครื่องเพิ่มระหว่างที่ยังผ่อนเครื่องเดิม. ' +
    'ห้ามใช้แทนการตอบเรื่องที่ตอบเองได้ · ห้ามรับปากผลแทนทีมงาน (อนุมัติ/ปลดล็อก/เลื่อนงวดได้) · ' +
    'เรื่องเดียวกันที่ในประวัติบอกลูกค้าไปแล้วว่าทีมงานจะตามให้ ไม่ต้องเรียกซ้ำ. ' +
    'ต่างจาก handoff_to_human (ใช้เมื่อคุณตอบเองไม่ได้ ลูกค้าขอคุยกับคน หรือ Red Flag — ระบบทิ้งข้อความของคุณแล้วบอทหยุดตอบห้องนี้)',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'สิ่งที่พนักงานต้องทำ สั้น ๆ + รุ่นที่ลูกค้าสนใจ เช่น "iPhone 15 128GB ขอดูรูปเครื่องจริง/สีชมพู" หรือ "ลูกค้าเก่า: ส่งสลิปค่างวด"',
      },
    },
    required: ['reason'],
  },
};

/** ห้องที่ปักธงแล้วขึ้นเป็น HIGH — ไม่แตะห้องที่ CRITICAL อยู่แล้ว (ห้ามลดความด่วน) */
const RAISABLE_PRIORITIES: ChatPriority[] = [ChatPriority.LOW, ChatPriority.NORMAL];

@Injectable()
export class NotifyStaffTool {
  private readonly logger = new Logger(NotifyStaffTool.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

  /**
   * การเขียนเหตุผล + เวลา เป็นงานหลักเพียงอย่างเดียวที่ทำให้เครื่องมือล้มได้ — ยกป้าย "ด่วน" และแจ้ง realtime
   * เป็นของเสริม ล้มแล้วแค่ warn (เดิม await สองครั้งไม่ครอบ ⇒ ยกป้ายพัง = runTool โยน = คำตอบทั้งเทิร์นหาย — รีวิว SB-V5)
   */
  async run(input: { reason: string; roomId: string }) {
    const raw = String(input.reason ?? '').trim();
    const reason = raw.slice(0, NOTIFY_STAFF_REASON_MAX) || 'ลูกค้าขอข้อมูลเครื่องจริง';
    const now = new Date();
    // อ่านคำขอเดิมก่อน (ต่อท้าย ไม่เขียนทับ) — อ่านไม่ได้ = ใช้เหตุผลของรอบนี้อย่างเดียว ไม่ล้มเครื่องมือ
    let current: {
      handoffMode: boolean;
      handoffReason: string | null;
      handoffTaggedAt: Date | null;
      priority: ChatPriority;
    } | null = null;
    try {
      current = await this.prisma.chatRoom.findUnique({
        where: { id: input.roomId },
        select: { handoffMode: true, handoffReason: true, handoffTaggedAt: true, priority: true },
      });
    } catch (err) {
      this.logger.warn(
        `[notify_staff] room=${input.roomId} read current flag failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    const handoffReason = mergeNotifyStaffReason(reason, current, now);
    // ห้ามตั้ง handoffMode — ธงนี้ต้องไม่ปิดบอท (router/shouldAutoReply ข้ามห้องที่ handoffMode = true)
    await this.prisma.chatRoom.update({
      where: { id: input.roomId },
      data: { handoffReason, handoffTaggedAt: now },
    });
    // ยกเป็น HIGH แบบมีเงื่อนไขในคำสั่งเดียว (ไม่อ่านแล้วเขียน — กันทับห้องที่เพิ่งถูกตั้ง CRITICAL)
    let priority: ChatPriority | undefined = current?.priority;
    try {
      const raised = await this.prisma.chatRoom.updateMany({
        where: { id: input.roomId, priority: { in: RAISABLE_PRIORITIES } },
        data: { priority: ChatPriority.HIGH },
      });
      if (raised.count > 0) priority = ChatPriority.HIGH;
    } catch (err) {
      this.logger.warn(
        `[notify_staff] room=${input.roomId} raise priority failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    // เหตุผลอาจมีชื่อลูกค้า (งานบริการลูกค้าเก่า) — ไม่ลงล็อก
    this.logger.log(`[notify_staff] room=${input.roomId} flagged (handoffMode untouched)`);
    // ให้แถวห้องในกล่องแชทพนักงานรีเฟรชทันที — ไม่ส่ง handoffMode ใน payload · priority = ค่าจริงของห้อง
    // (ยกแล้ว = HIGH · ห้อง CRITICAL คง CRITICAL · อ่านค่าไม่ได้และยกไม่สำเร็จ = ไม่ส่ง)
    try {
      this.gateway?.emitRoomUpdate(input.roomId, {
        event: 'staff_attention',
        roomId: input.roomId,
        ...(priority ? { priority } : {}),
        reason: handoffReason,
      });
    } catch (err) {
      this.logger.warn(
        `[notify_staff] room=${input.roomId} realtime emit failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { staffNotified: true };
  }
}
