import { Injectable, Logger } from '@nestjs/common';
import { LineOaService } from '../line-oa/line-oa.service';
import { ConfigService } from '@nestjs/config';
import { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';

export interface ContactInquiry {
  name: string;
  phone: string;
  message: string;
}

@Injectable()
export class ShopLineChatService {
  private readonly logger = new Logger(ShopLineChatService.name);

  constructor(
    private readonly lineOaService: LineOaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Notify staff of a new contact inquiry from the online shop.
   * Sends a LINE push message to the configured staff LINE user ID.
   * If no staff LINE ID is configured, logs the inquiry and returns gracefully.
   */
  async notifyStaffOfInquiry(inquiry: ContactInquiry): Promise<void> {
    const staffLineId = this.configService.get<string>('SHOP_STAFF_LINE_ID');

    const text =
      `[BESTCHOICE SHOP] สอบถามจากเว็บไซต์\n` +
      `ชื่อ: ${inquiry.name}\n` +
      `โทร: ${inquiry.phone}\n` +
      `ข้อความ: ${inquiry.message}`;

    if (!staffLineId) {
      // TODO: wire SHOP_STAFF_LINE_ID env var when staff LINE account is ready
      this.logger.log(
        `[ShopLineChat] SHOP_STAFF_LINE_ID not configured — inquiry logged only: ${text}`,
      );
      return;
    }

    try {
      await this.lineOaService.pushMessage(staffLineId, [
        { type: 'text', text } as unknown as LineMessagePayload,
      ]);
      this.logger.log(`[ShopLineChat] Inquiry notification sent to staff LINE ID ${staffLineId}`);
    } catch (err) {
      this.logger.error(`[ShopLineChat] Failed to send LINE notification: ${err}`);
    }
  }
}
