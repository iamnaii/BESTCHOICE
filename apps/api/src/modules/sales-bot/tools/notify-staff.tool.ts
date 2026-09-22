import { Injectable } from '@nestjs/common';
import { HandoffToHumanTool } from './handoff-to-human.tool';

/**
 * ปักธงให้พนักงานตามต่อ "โดยคำตอบของบอทในเทิร์นนี้ยังส่งถึงลูกค้า" (เจ้าของสั่ง 2026-09-22:
 * โหมดไม่มีสต๊อก — ลูกค้าขอดูรูปเครื่องจริง/สี/แบต → บอกว่าแอดมินจะส่งรูปให้ + เรียกพนักงาน)
 *
 * ต่างจาก handoff_to_human ตรงที่ handoff = "บอทตอบไม่ได้" (confidence 0.3 → router ทิ้งคำตอบ
 * แล้วส่งประโยคกลางแทน) ส่วนตัวนี้ = บอทตอบได้แล้ว แค่ต้องให้คนส่งของที่บอทส่งไม่ได้ (รูปเครื่องจริง)
 * ⇒ ไม่ลด confidence และ MessageRouter นับเป็นธงที่บอทปักเอง (ส่งคำตอบต่อ ไม่กลืนทิ้ง)
 * ใช้ตัวปักธงเดียวกับ handoff_to_human (handoffMode + reason + แจ้ง inbox แบบ realtime)
 */
export const NOTIFY_STAFF_TOOL = {
  name: 'notify_staff',
  description:
    'แจ้งพนักงานให้ตามต่อในห้องนี้ เมื่อลูกค้าขอสิ่งที่บอทส่งเองไม่ได้ เช่น รูปเครื่องจริง สี แบต สภาพ "มีของไหม" — ' +
    'ข้อความที่คุณตอบลูกค้าในเทิร์นนี้ยังส่งตามปกติ แล้วพนักงานจะคุยต่อเอง. ' +
    'ต่างจาก handoff_to_human (ใช้เมื่อคุณตอบเองไม่ได้ หรือลูกค้าขอคุยกับคน)',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'รุ่นที่ลูกค้าสนใจ + สิ่งที่ลูกค้าขอ สั้น ๆ ให้พนักงานอ่าน เช่น "iPhone 15 128GB ขอดูรูปเครื่องจริง/สีชมพู"',
      },
    },
    required: ['reason'],
  },
};

@Injectable()
export class NotifyStaffTool {
  constructor(private readonly handoff: HandoffToHumanTool) {}

  async run(input: { reason: string; roomId: string }) {
    const reason = String(input.reason ?? '').trim().slice(0, 300) || 'ลูกค้าขอข้อมูลเครื่องจริง';
    await this.handoff.run({ reason: `[บอทขอให้พนักงานตามต่อ] ${reason}`, roomId: input.roomId });
    return { staffNotified: true };
  }
}
