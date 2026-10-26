import { Injectable, Logger, Optional } from '@nestjs/common';
import { StaffNotifyService } from '../staff-notify/staff-notify.service';
import { maskPhone } from '../chatbot-finance/utils/mask-phone';

export interface ContactInquiry {
  name: string;
  phone: string;
  message: string;
}

@Injectable()
export class ShopLineChatService {
  private readonly logger = new Logger(ShopLineChatService.name);

  constructor(@Optional() private readonly staffNotify?: StaffNotifyService) {}

  /**
   * แจ้งพนักงานว่ามีข้อความสอบถามจากเว็บร้าน — ผ่านท่อกลาง StaffNotifyService (เหตุการณ์ chat.web_inquiry)
   * (เดิมส่งไป env SHOP_STAFF_LINE_ID ซึ่งไม่ได้ตั้งบน prod — ก้อน 7 A16 §13.4)
   * ไม่ log เนื้อหา (ชื่อ+เบอร์ = PII) — log แค่หางเบอร์
   */
  async notifyStaffOfInquiry(inquiry: ContactInquiry): Promise<void> {
    const phoneTail = inquiry.phone ? inquiry.phone.slice(-4) : '????';
    if (!this.staffNotify) {
      this.logger.warn(`[ShopLineChat] StaffNotifyService unavailable — inquiry dropped (phone ***${phoneTail})`);
      return;
    }
    try {
      // fire-and-forget — endpoint สาธารณะต้องไม่รอ LINE (รีวิว I6)
      void this.staffNotify.notify('chat.web_inquiry', {
        title: 'ข้อความสอบถามจากเว็บ',
        lines: [`ชื่อ: ${inquiry.name}`, `โทร: ${inquiry.phone ? maskPhone(inquiry.phone) : '-'}`, `ข้อความ: ${inquiry.message}`],
        link: '/inbox',
      }).catch((err) => this.logger.error(`[ShopLineChat] staff hub failed (phone ***${phoneTail}): ${err instanceof Error ? err.message : err}`));
    } catch (err) {
      this.logger.error(`[ShopLineChat] Failed to notify staff (phone ***${phoneTail}): ${err instanceof Error ? err.message : err}`);
    }
  }
}
