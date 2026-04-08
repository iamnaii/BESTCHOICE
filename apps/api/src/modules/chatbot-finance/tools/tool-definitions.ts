/**
 * Tool definitions สำหรับ Claude tool use
 *
 * Schema เป็น JSON Schema แบบ Anthropic accept
 * หมายเหตุ: customerId ไม่ต้องอยู่ใน schema — orchestrator จะ inject ให้อัตโนมัติ
 *           เพื่อให้ AI ไม่สามารถเรียก tool กับลูกค้าคนอื่นได้
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const FINANCE_TOOLS: Tool[] = [
  {
    name: 'get_current_balance',
    description:
      'ดึงยอดที่ลูกค้าต้องชำระงวดถัดไป รวมค่าปรับถ้าเลยกำหนด ' +
      'ใช้เมื่อลูกค้าถาม: "ยอดเท่าไหร่", "งวดนี้จ่ายเท่าไหร่", "ครบกำหนดเมื่อไหร่"',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_payment_schedule',
    description:
      'ดึงสรุปตารางผ่อนทั้งหมด: จำนวนงวดทั้งหมด งวดที่จ่ายแล้ว งวดคงเหลือ ยอดรวม ' +
      'ใช้เมื่อลูกค้าถาม: "เหลือกี่งวด", "ผ่อนกี่งวดแล้ว", "ตารางผ่อน"',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'calculate_fine',
    description:
      'คำนวณค่าปรับสำหรับการชำระล่าช้า (50 บาท/วัน) ' +
      'ใช้เมื่อลูกค้าถาม: "ค่าปรับเท่าไหร่", "ถ้าจ่ายช้า X วันจะปรับเท่าไหร่"',
    input_schema: {
      type: 'object',
      properties: {
        daysOverdue: {
          type: 'number',
          description: 'จำนวนวันที่เลยกำหนด',
          minimum: 0,
        },
      },
      required: ['daysOverdue'],
    },
  },
  {
    name: 'list_recent_receipts',
    description:
      'ดึงประวัติใบเสร็จ 5 งวดล่าสุดที่ชำระแล้ว ' +
      'ใช้เมื่อลูกค้าถาม: "ใบเสร็จ", "ดูประวัติชำระ", "งวดที่จ่ายแล้ว"',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_bank_info',
    description:
      'คืนข้อมูลบัญชีธนาคารบริษัทสำหรับโอนเงิน ' +
      'ใช้เมื่อลูกค้าถาม: "เลขบัญชี", "โอนยังไง", "บัญชีอะไร"',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'ค้นหา FAQ ที่เกี่ยวข้องกับคำถามลูกค้า ใช้เมื่อไม่แน่ใจคำตอบ — ' +
      'จะคืน FAQ entries ที่ admin set ไว้ล่วงหน้า ใช้เป็น reference สำหรับตอบ',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'คำถามของลูกค้าหรือ keyword ที่ต้องการค้นหา',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'handoff_to_human',
    description:
      'ส่งต่อให้พนักงานเมื่อ: (1) ลูกค้าโกรธ/complaint (2) เรื่องที่ต้องคนตัดสินใจ ' +
      'เช่น ขอเลื่อนชำระ ขอปลดล็อก ปิดยอด ขอผ่อนผัน (3) bot ตอบไม่มั่นใจ ' +
      'ใช้ priority="critical" สำหรับ complaint, "high" สำหรับเรื่องเงินเร่งด่วน',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'เหตุผลสั้น ๆ เช่น "ขอเลื่อนชำระ", "complaint ค่าปรับ"',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'ระดับความเร่งด่วน',
        },
        summary: {
          type: 'string',
          description: 'สรุปสั้น ๆ เกี่ยวกับเรื่องที่ลูกค้ากำลังพูด เพื่อให้พนักงานเข้าใจ context',
        },
      },
      required: ['reason', 'priority', 'summary'],
    },
  },
];

export type ToolName =
  | 'get_current_balance'
  | 'get_payment_schedule'
  | 'calculate_fine'
  | 'list_recent_receipts'
  | 'get_bank_info'
  | 'search_knowledge_base'
  | 'handoff_to_human';
