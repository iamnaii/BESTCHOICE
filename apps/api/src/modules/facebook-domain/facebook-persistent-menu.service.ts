import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  private readonly pageAccessToken?: string;
  private readonly pageId?: string;

  constructor(private configService: ConfigService) {
    this.pageAccessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
    this.pageId = this.configService.get<string>('FB_PAGE_ID');
  }

  private get isConfigured(): boolean {
    return !!this.pageAccessToken && !!this.pageId;
  }

  /**
   * Set the persistent menu for the Facebook Page.
   * Call once on setup or when menu needs updating.
   */
  async setupMenu(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured) {
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
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${this.pageId}/messenger_profile?access_token=${this.pageAccessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(menu),
          signal: AbortSignal.timeout(10_000),
        },
      );

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
    if (!this.isConfigured) {
      return { success: false, error: 'Facebook not configured' };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${this.pageId}/messenger_profile?access_token=${this.pageAccessToken}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: ['persistent_menu'] }),
          signal: AbortSignal.timeout(10_000),
        },
      );

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
}
