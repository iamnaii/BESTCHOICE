import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RichMenuUrls {
  /** URL หน้าหลักร้าน / รายการสินค้า เช่น https://bestchoicephone.app */
  websiteUrl: string;
  /** URL หน้าคำนวณค่างวด เช่น https://bestchoicephone.app/calculator */
  calculatorUrl: string;
  /** LIFF URL สำหรับหน้าเช็คสัญญา เช่น https://liff.line.me/xxxx/liff/contract */
  liffContractUrl: string;
  /** LIFF URL สำหรับหน้าจ่ายค่างวด เช่น https://liff.line.me/xxxx/liff/early-payoff */
  liffPayUrl: string;
  /** Google Maps URL ของร้าน */
  mapsUrl: string;
}

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
   * BESTCHOICE SHOP Rich Menu (2026 Brand — v3)
   * Layout: 2 rows x 3 columns (2500x1686)
   *
   * ┌─────────────────┬─────────────────┬─────────────────┐
   * │ 📱 ดูรุ่นที่มี  │ 💰 คำนวณค่างวด │ 📋 เช็คสัญญา   │
   * ├─────────────────┼─────────────────┼─────────────────┤
   * │ 💳 จ่ายค่างวด  │ 📍 แผนที่ร้าน  │ 💬 แชทกับเรา   │
   * └─────────────────┴─────────────────┴─────────────────┘
   *
   * Image: ใช้รูป 2500x1686 สีเขียว BESTCHOICE brand
   * แต่ละช่องมี icon + label สีขาวบนพื้นเขียว
   */
  async createShopRichMenu(urls: RichMenuUrls): Promise<string> {
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'BESTCHOICE SHOP Menu v3',
      chatBarText: '📱 เมนูร้าน',
      areas: [
        // Row 1
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'uri', label: '📱 ดูรุ่นที่มี', uri: urls.websiteUrl },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'uri', label: '💰 คำนวณค่างวด', uri: urls.calculatorUrl },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'uri', label: '📋 เช็คสัญญา', uri: urls.liffContractUrl },
        },
        // Row 2
        {
          bounds: { x: 0, y: 843, width: 833, height: 843 },
          action: { type: 'uri', label: '💳 จ่ายค่างวด', uri: urls.liffPayUrl },
        },
        {
          bounds: { x: 833, y: 843, width: 834, height: 843 },
          action: { type: 'uri', label: '📍 แผนที่ร้าน', uri: urls.mapsUrl },
        },
        {
          bounds: { x: 1667, y: 843, width: 833, height: 843 },
          action: { type: 'message', label: '💬 แชทกับเรา', text: 'สวัสดีค่ะ' },
        },
      ],
    };

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu);
    const data = await response.json();
    this.logger.log(`SHOP Rich Menu created: ${data.richMenuId}`);
    return data.richMenuId;
  }

  /**
   * BESTCHOICE FINANCE Rich Menu (2026 — v1)
   * Layout: 2 rows x 3 columns (2500x1686)
   *
   * ┌─────────────────┬─────────────────┬─────────────────┐
   * │ 💰 เช็คยอด     │ 📊 ดูตารางงวด  │ 💳 ชำระเงิน    │
   * ├─────────────────┼─────────────────┼─────────────────┤
   * │ 🧾 ประวัติชำระ │ 📋 เช็คสัญญา   │ 💬 ถามน้องเบส  │
   * └─────────────────┴─────────────────┴─────────────────┘
   *
   * Image: ใช้รูป 2500x1686 สีน้ำเงิน FINANCE brand
   * แต่ละช่องมี icon + label สีขาวบนพื้นน้ำเงิน
   */
  async createFinanceRichMenu(liffBaseUrl: string): Promise<string> {
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'BESTCHOICE FINANCE Menu v1',
      chatBarText: '💰 เมนูการเงิน',
      areas: [
        // Row 1
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'message', label: '💰 เช็คยอด', text: 'เช็คยอด' },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'message', label: '📊 ดูตารางงวด', text: 'งวด' },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'message', label: '💳 ชำระเงิน', text: 'ชำระ' },
        },
        // Row 2
        {
          bounds: { x: 0, y: 843, width: 833, height: 843 },
          action: { type: 'uri', label: '🧾 ประวัติชำระ', uri: `${liffBaseUrl}/liff/history` },
        },
        {
          bounds: { x: 833, y: 843, width: 834, height: 843 },
          action: { type: 'uri', label: '📋 เช็คสัญญา', uri: `${liffBaseUrl}/liff/contract` },
        },
        {
          bounds: { x: 1667, y: 843, width: 833, height: 843 },
          action: { type: 'message', label: '💬 ถามน้องเบส', text: 'ช่วยเหลือ' },
        },
      ],
    };

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu);
    const data = await response.json();
    this.logger.log(`FINANCE Rich Menu created: ${data.richMenuId}`);
    return data.richMenuId;
  }

  /** @deprecated Use createShopRichMenu instead */
  async createRichMenu(urls: RichMenuUrls): Promise<string> {
    return this.createShopRichMenu(urls);
  }

  /**
   * Create default 6-button rich menu from a single LIFF base URL.
   * Convenience method for quick setup — mirrors the SHOP layout.
   *
   * ┌─────────────────┬─────────────────┬─────────────────┐
   * │ 📱 ดูสินค้า    │ 💰 ผ่อนชำระ    │ 📋 สัญญาของฉัน │
   * ├─────────────────┼─────────────────┼─────────────────┤
   * │ 💳 ชำระเงิน   │ 🎁 โปรโมชัน    │ 💬 ติดต่อเรา   │
   * └─────────────────┴─────────────────┴─────────────────┘
   */
  async createDefaultRichMenu(liffUrl: string): Promise<string> {
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'BESTCHOICE Menu',
      chatBarText: 'เมนู',
      areas: [
        // Row 1
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'uri', label: 'ดูสินค้า', uri: liffUrl },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'uri', label: 'ผ่อนชำระ', uri: `${liffUrl}/liff/contract` },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'uri', label: 'สัญญาของฉัน', uri: `${liffUrl}/liff/contract` },
        },
        // Row 2
        {
          bounds: { x: 0, y: 843, width: 833, height: 843 },
          action: { type: 'uri', label: 'ชำระเงิน', uri: `${liffUrl}/liff/early-payoff` },
        },
        {
          bounds: { x: 833, y: 843, width: 834, height: 843 },
          action: { type: 'message', label: 'โปรโมชัน', text: 'โปรโมชัน' },
        },
        {
          bounds: { x: 1667, y: 843, width: 833, height: 843 },
          action: { type: 'message', label: 'ติดต่อเรา', text: 'คุยกับพนักงาน' },
        },
      ],
    };

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu);
    const data = await response.json();
    this.logger.log(`Default Rich Menu created: ${data.richMenuId}`);
    return data.richMenuId;
  }

  /**
   * Get current default Rich Menu ID
   */
  async getDefaultRichMenuId(): Promise<string | null> {
    if (!this.lineChannelAccessToken) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `${this.lineApiBaseUrl}/user/all/richmenu`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.lineChannelAccessToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to get default Rich Menu: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    return (data as { richMenuId?: string }).richMenuId ?? null;
  }

  /**
   * Upload Rich Menu image
   * The image should be 2500x1686 pixels, JPEG or PNG
   */
  async uploadRichMenuImage(richMenuId: string, imageBuffer: Buffer): Promise<void> {
    if (!this.lineChannelAccessToken) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
        'Content-Type': 'image/png',
      },
      body: new Uint8Array(imageBuffer),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to upload Rich Menu image: ${response.status} ${errorBody}`);
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to set default Rich Menu: ${response.status} ${errorBody}`);
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to delete Rich Menu: ${response.status} ${errorBody}`);
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to list Rich Menus: ${response.status}`);
    }

    const data = await response.json();
    return data.richmenus || [];
  }

  private async callLineApi(url: string, body: unknown): Promise<Response> {
    if (!this.lineChannelAccessToken) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }

    return response;
  }
}
