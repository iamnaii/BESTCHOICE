import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Rich Menu Management Service
 * Creates and manages LINE Rich Menu via LINE Messaging API
 */
@Injectable()
export class RichMenuService {
  private readonly logger = new Logger(RichMenuService.name);
  private readonly lineChannelAccessToken: string | undefined;
  private readonly lineApiBaseUrl = 'https://api.line.me/v2/bot';

  constructor(private configService: ConfigService) {
    this.lineChannelAccessToken = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
  }

  /**
   * Create the BEST CHOICE Rich Menu
   * Layout: 2 rows x 3 columns
   *
   * ┌──────────┬──────────┬──────────┐
   * │ ชำระเงิน │ เช็คยอด  │ ติดต่อ   │
   * ├──────────┼──────────┼──────────┤
   * │ ประวัติ  │ ใบเสร็จ  │ ช่วยเหลือ│
   * └──────────┴──────────┴──────────┘
   */
  async createRichMenu(): Promise<string> {
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'BEST CHOICE Menu',
      chatBarText: 'เมนู',
      areas: [
        // Row 1
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'postback', label: 'ชำระเงิน', data: 'action=pay' },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'postback', label: 'เช็คยอด', data: 'action=check_balance' },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'message', label: 'ติดต่อ', text: 'ติดต่อ' },
        },
        // Row 2
        {
          bounds: { x: 0, y: 843, width: 833, height: 843 },
          action: { type: 'postback', label: 'ประวัติ', data: 'action=check_installments' },
        },
        {
          bounds: { x: 833, y: 843, width: 834, height: 843 },
          action: { type: 'message', label: 'ใบเสร็จ', text: 'ใบเสร็จ' },
        },
        {
          bounds: { x: 1667, y: 843, width: 833, height: 843 },
          action: { type: 'message', label: 'ช่วยเหลือ', text: 'ช่วยเหลือ' },
        },
      ],
    };

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu);
    const data = await response.json();
    const richMenuId = data.richMenuId;

    this.logger.log(`Rich Menu created: ${richMenuId}`);
    return richMenuId;
  }

  /**
   * Upload Rich Menu image
   * The image should be 2500x1686 pixels, JPEG or PNG
   */
  async uploadRichMenuImage(richMenuId: string, imageBuffer: Buffer): Promise<void> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
        'Content-Type': 'image/png',
      },
      body: new Uint8Array(imageBuffer),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to upload Rich Menu image: ${response.status} ${errorBody}`);
    }

    this.logger.log(`Rich Menu image uploaded for ${richMenuId}`);
  }

  /**
   * Set default Rich Menu for all users
   */
  async setDefaultRichMenu(richMenuId: string): Promise<void> {
    const url = `${this.lineApiBaseUrl}/user/all/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to set default Rich Menu: ${response.status} ${errorBody}`);
    }

    this.logger.log(`Default Rich Menu set to ${richMenuId}`);
  }

  /**
   * Delete a Rich Menu
   */
  async deleteRichMenu(richMenuId: string): Promise<void> {
    const url = `${this.lineApiBaseUrl}/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to delete Rich Menu: ${response.status} ${errorBody}`);
    }

    this.logger.log(`Rich Menu deleted: ${richMenuId}`);
  }

  /**
   * List all Rich Menus
   */
  async listRichMenus(): Promise<unknown[]> {
    const url = `${this.lineApiBaseUrl}/richmenu/list`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list Rich Menus: ${response.status}`);
    }

    const data = await response.json();
    return data.richmenus || [];
  }

  private async callLineApi(url: string, body: unknown): Promise<Response> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorBody}`);
    }

    return response;
  }
}
