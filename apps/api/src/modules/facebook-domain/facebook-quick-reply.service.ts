import { Injectable } from '@nestjs/common';

/**
 * Facebook Quick Reply button format.
 * https://developers.facebook.com/docs/messenger-platform/send-messages/quick-replies
 *
 * Constraints:
 * - Max 13 quick replies per message
 * - Title max 20 characters
 * - Payload max 1,000 characters
 */
export interface FacebookQuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

@Injectable()
export class FacebookQuickReplyService {
  /** Quick Reply สำหรับทักทาย/ข้อความแรก */
  greeting(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '📱 ดูสินค้า', payload: 'ดูสินค้า' },
      { content_type: 'text', title: '💰 สอบถามราคา', payload: 'สอบถามราคา' },
      { content_type: 'text', title: '📄 ดูสัญญา', payload: 'ดูสัญญา' },
      { content_type: 'text', title: '💬 คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
    ];
  }

  /** Quick Reply หลังชำระเงิน */
  afterPayment(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '🧾 ดูใบเสร็จ', payload: 'ดูใบเสร็จ' },
      { content_type: 'text', title: '💰 ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
      { content_type: 'text', title: '📄 ดูสัญญา', payload: 'ดูสัญญา' },
    ];
  }

  /** Quick Reply สำหรับเลือก brand */
  brandSelection(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '🍎 iPhone', payload: 'iPhone' },
      { content_type: 'text', title: '📱 Samsung', payload: 'Samsung' },
      { content_type: 'text', title: '📱 OPPO', payload: 'OPPO' },
      { content_type: 'text', title: '📱 vivo', payload: 'vivo' },
      { content_type: 'text', title: '📱 Xiaomi', payload: 'Xiaomi' },
      { content_type: 'text', title: '🔍 อื่นๆ', payload: 'ดูทั้งหมด' },
    ];
  }

  /** Quick Reply สำหรับถามข้อมูลเพิ่ม */
  moreInfo(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '💳 เงื่อนไขผ่อน', payload: 'เงื่อนไขผ่อน' },
      { content_type: 'text', title: '📍 สาขา', payload: 'สาขาไหนบ้าง' },
      { content_type: 'text', title: '📋 เอกสาร', payload: 'ใช้เอกสารอะไร' },
      { content_type: 'text', title: '💬 คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
    ];
  }

  /** Quick Reply สำหรับ onboarding ใหม่ (ลูกค้า FB = ไม่แยก shop/finance) */
  onboarding(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: 'ลูกค้าใหม่', payload: 'ลูกค้าใหม่' },
      { content_type: 'text', title: 'มีสัญญาอยู่แล้ว', payload: 'ลงทะเบียน' },
      { content_type: 'text', title: 'วิธีชำระเงิน', payload: 'วิธีชำระเงิน' },
    ];
  }

  /** Quick Reply สำหรับลูกค้า verified ที่กลับมา */
  verifiedReturn(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: 'เช็คยอด', payload: 'เช็คยอด' },
      { content_type: 'text', title: 'ดูสัญญา', payload: 'สัญญา' },
      { content_type: 'text', title: 'ช่วยเหลือ', payload: 'ช่วยเหลือ' },
    ];
  }
}
