import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * Manages the Facebook Messenger persistent menu via Graph API.
 * Equivalent of LINE Rich Menu.
 *
 * Constraints:
 * - Max 3 top-level items
 * - Each top-level can have up to 5 nested items
 * - Title max 30 characters
 *
 * API: POST /{PAGE_ID}/messenger_profile
 * https://developers.facebook.com/docs/messenger-platform/reference/messenger-profile-api/persistent-menu
 */
@Injectable()
export class FacebookPersistentMenuService {
  private readonly logger = new Logger(FacebookPersistentMenuService.name);

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  /**
   * อ่าน creds จาก IntegrationConfig (DB → env fallback) ทุกครั้งที่เรียก
   * เหมือน FacebookAdapter — เดิมอ่านจาก env ตอน constructor ทำให้เพจที่ตั้งค่า
   * ผ่านหน้า Settings อย่างเดียวใช้ไม่ได้เลย
   */
  private async getCreds(): Promise<{ pageAccessToken?: string; pageId?: string }> {
    const cfg = await this.integrationConfig.getConfig('facebook');
    return {
      pageAccessToken: cfg.pageAccessToken || undefined,
      pageId: cfg.pageId || undefined,
    };
  }

  /**
   * Set the persistent menu for the Facebook Page.
   * Call once on setup or when menu needs updating.
   */
  async setupMenu(): Promise<{ success: boolean; error?: string }> {
    const { pageAccessToken, pageId } = await this.getCreds();
    if (!pageAccessToken || !pageId) {
      return { success: false, error: 'Facebook not configured' };
    }

    const menu = {
      persistent_menu: [
        {
          locale: 'default',
          composer_input_disabled: false,
          call_to_actions: [
            {
              type: 'nested',
              title: '📊 เช็คข้อมูล',
              call_to_actions: [
                { type: 'postback', title: 'เช็คยอด', payload: 'เช็คยอด' },
                { type: 'postback', title: 'ดูสัญญา', payload: 'ดูสัญญา' },
                { type: 'postback', title: 'ประวัติชำระ', payload: 'ประวัติชำระ' },
              ],
            },
            {
              type: 'postback',
              title: '💳 ชำระเงิน',
              payload: 'ชำระ',
            },
            {
              type: 'nested',
              title: '📞 ติดต่อเรา',
              call_to_actions: [
                { type: 'postback', title: 'คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
                {
                  type: 'web_url',
                  title: 'แผนที่ร้าน',
                  url: 'https://maps.google.com/?q=BESTCHOICE',
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/messenger_profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pageAccessToken}`,
        },
        body: JSON.stringify(menu),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB Menu] Setup failed ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      this.logger.log('[FB Menu] Persistent menu set successfully');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Menu] Setup error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Remove the persistent menu from the Facebook Page.
   */
  async removeMenu(): Promise<{ success: boolean; error?: string }> {
    const { pageAccessToken, pageId } = await this.getCreds();
    if (!pageAccessToken || !pageId) {
      return { success: false, error: 'Facebook not configured' };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/messenger_profile`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pageAccessToken}`,
        },
        body: JSON.stringify({ fields: ['persistent_menu'] }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB Menu] Remove failed ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      this.logger.log('[FB Menu] Persistent menu removed');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Menu] Remove error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * ตั้งปุ่ม "เริ่มต้นใช้งาน" + ข้อความทักทายของเพจ
   *
   * จำเป็นสำหรับลิงก์ m.me/<page>?ref=p:<productId> จากหน้าสินค้า: ผู้ใช้ใหม่ที่
   * ยังไม่เคยคุยกับเพจจะได้หน้าจอ Get Started ก่อน และ Facebook จะแนบ `ref`
   * มากับ postback ของปุ่มนี้เท่านั้น — ไม่มีปุ่ม = ref หายทั้งดุ้น
   */
  async setupGetStarted(): Promise<{ success: boolean; error?: string }> {
    const { pageAccessToken, pageId } = await this.getCreds();
    if (!pageAccessToken || !pageId) {
      return { success: false, error: 'Facebook not configured' };
    }

    const profile = {
      get_started: { payload: 'GET_STARTED' },
      greeting: [
        {
          locale: 'default',
          text: 'สวัสดีครับ ร้าน BESTCHOICE ลพบุรี 👋 ทักมาสอบถามรุ่น ราคา หรือยอดผ่อนได้เลยครับ',
        },
      ],
    };

    try {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/messenger_profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pageAccessToken}`,
        },
        body: JSON.stringify(profile),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB Menu] Get Started setup failed ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      this.logger.log('[FB Menu] Get Started button + greeting set successfully');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Menu] Get Started setup error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
}
