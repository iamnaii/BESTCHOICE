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
];

export type ToolName =
  | 'get_current_balance'
  | 'get_payment_schedule'
  | 'calculate_fine'
  | 'list_recent_receipts'
  | 'get_bank_info';
