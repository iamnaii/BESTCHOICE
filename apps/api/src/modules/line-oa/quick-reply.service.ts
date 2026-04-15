import { Injectable } from '@nestjs/common';
import { LineQuickReplyItem } from './dto/webhook-event.dto';

@Injectable()
export class QuickReplyService {
  /** Quick Reply สำหรับทักทาย/ข้อความแรก */
  greeting(): LineQuickReplyItem[] {
    return [
      { type: 'action', action: { type: 'message', label: '📱 ดูสินค้า', text: 'ดูสินค้า' } },
      { type: 'action', action: { type: 'message', label: '💰 สอบถามราคา', text: 'สอบถามราคา' } },
      { type: 'action', action: { type: 'message', label: '📄 ดูสัญญา', text: 'ดูสัญญา' } },
      { type: 'action', action: { type: 'message', label: '💬 คุยกับพนักงาน', text: 'คุยกับพนักงาน' } },
    ];
  }

  /** Quick Reply หลังชำระเงิน */
  afterPayment(): LineQuickReplyItem[] {
    return [
      { type: 'action', action: { type: 'message', label: '🧾 ดูใบเสร็จ', text: 'ดูใบเสร็จ' } },
      { type: 'action', action: { type: 'message', label: '💰 ดูยอดคงเหลือ', text: 'ดูยอดคงเหลือ' } },
      { type: 'action', action: { type: 'message', label: '📄 ดูสัญญา', text: 'ดูสัญญา' } },
    ];
  }

  /** Quick Reply สำหรับเลือก brand */
  brandSelection(): LineQuickReplyItem[] {
    return [
      { type: 'action', action: { type: 'message', label: '🍎 iPhone', text: 'iPhone' } },
      { type: 'action', action: { type: 'message', label: '📱 Samsung', text: 'Samsung' } },
      { type: 'action', action: { type: 'message', label: '📱 OPPO', text: 'OPPO' } },
      { type: 'action', action: { type: 'message', label: '📱 vivo', text: 'vivo' } },
      { type: 'action', action: { type: 'message', label: '📱 Xiaomi', text: 'Xiaomi' } },
      { type: 'action', action: { type: 'message', label: '🔍 อื่นๆ', text: 'ดูทั้งหมด' } },
    ];
  }

  /** Quick Reply สำหรับถามข้อมูลเพิ่ม */
  moreInfo(): LineQuickReplyItem[] {
    return [
      { type: 'action', action: { type: 'message', label: '💳 เงื่อนไขผ่อน', text: 'เงื่อนไขผ่อน' } },
      { type: 'action', action: { type: 'message', label: '📍 สาขา', text: 'สาขาไหนบ้าง' } },
      { type: 'action', action: { type: 'message', label: '📋 เอกสาร', text: 'ใช้เอกสารอะไร' } },
      { type: 'action', action: { type: 'message', label: '💬 คุยกับพนักงาน', text: 'คุยกับพนักงาน' } },
    ];
  }
}
