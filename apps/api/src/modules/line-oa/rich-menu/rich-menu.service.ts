import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

export interface MenuButton {
  label: string;
  emoji?: string;
  color?: string;
  actionType: 'uri' | 'message';
  actionValue: string;
}

export interface CreateMenuParams {
  name?: string;
  chatBarText?: string;
  liffUrl?: string;
  layout?: '2x3' | '1x3' | '2x2';
  buttons?: MenuButton[];
  setAsDefault?: boolean;
}

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
  private readonly lineApiBaseUrl = 'https://api.line.me/v2/bot';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  private async getChannelToken(channel: 'shop' | 'finance' = 'shop'): Promise<string> {
    const key = channel === 'shop' ? 'line-shop' : 'line-finance';
    const token = await this.integrationConfig.getValue(key, 'channelToken');
    if (!token) {
      throw new BadRequestException(
        `LINE ${channel === 'shop' ? 'SHOP' : 'FINANCE'} channel token ยังไม่ถูกตั้งค่า — กรุณาไปที่ /settings/integrations`,
      );
    }
    return token;
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

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu, 'shop');
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

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu, 'finance');
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
    const result = await this.createCustomRichMenu({ liffUrl });
    return result.richMenuId;
  }

  /**
   * Create a fully customizable rich menu.
   * Supports 2x3 (default), 1x3, and 2x2 layouts with custom buttons and actions.
   */
  async createCustomRichMenu(
    params: CreateMenuParams,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<{ richMenuId: string }> {
    const {
      name = 'BESTCHOICE Menu',
      chatBarText = 'เมนู',
      liffUrl = '',
      layout = '2x3',
      buttons,
    } = params;

    const { cols, rows, height } = this.getGridDimensions(layout);
    const totalButtons = cols * rows;

    // Use 2500-wide grid, divide evenly across columns
    // Middle column in odd-cols layout gets +1px to reach exactly 2500
    const cellHeight = height / rows;

    const areas: Array<{ bounds: { x: number; y: number; width: number; height: number }; action: Record<string, string> }> = [];
    for (let i = 0; i < totalButtons; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const btn = buttons?.[i];

      // Distribute width evenly; last column takes remainder
      const baseWidth = Math.floor(2500 / cols);
      const lastColExtra = 2500 - baseWidth * (cols - 1);
      const cellWidth = col === cols - 1 ? lastColExtra : baseWidth;
      const xOffset = col * baseWidth;

      let action: Record<string, string>;
      if (btn) {
        if (btn.actionType === 'uri') {
          action = {
            type: 'uri',
            uri: btn.actionValue || liffUrl || '#',
            label: btn.label,
          };
        } else {
          action = {
            type: 'message',
            text: btn.actionValue || btn.label,
            label: btn.label,
          };
        }
      } else {
        // Fallback defaults when no button config provided
        const defaultActions: Record<string, string>[] = [
          { type: 'uri', uri: liffUrl || '#', label: 'ดูสินค้า' },
          { type: 'uri', uri: `${liffUrl}/liff/contract`, label: 'ผ่อนชำระ' },
          { type: 'uri', uri: `${liffUrl}/liff/contract`, label: 'สัญญาของฉัน' },
          { type: 'uri', uri: `${liffUrl}/liff/early-payoff`, label: 'ชำระเงิน' },
          { type: 'message', text: 'โปรโมชัน', label: 'โปรโมชัน' },
          { type: 'message', text: 'คุยกับพนักงาน', label: 'ติดต่อเรา' },
        ];
        action = defaultActions[i] ?? { type: 'message', text: `button${i + 1}`, label: `Button ${i + 1}` };
      }

      areas.push({
        bounds: {
          x: xOffset,
          y: row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        },
        action,
      });
    }

    const body = {
      size: { width: 2500, height },
      selected: true,
      name,
      chatBarText,
      areas,
    };

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, body, channel);
    const data = await response.json();
    this.logger.log(`Custom Rich Menu created: ${data.richMenuId} (layout=${layout}, channel=${channel})`);
    return { richMenuId: data.richMenuId };
  }

  private getGridDimensions(layout: string): { cols: number; rows: number; height: number } {
    switch (layout) {
      case '1x3':
        return { cols: 3, rows: 1, height: 843 };
      case '2x2':
        return { cols: 2, rows: 2, height: 1686 };
      case '2x3':
      default:
        return { cols: 3, rows: 2, height: 1686 };
    }
  }

  /**
   * Get current default Rich Menu ID
   */
  async getDefaultRichMenuId(channel: 'shop' | 'finance' = 'shop'): Promise<string | null> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/all/richmenu`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) return null;

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
  async uploadRichMenuImage(
    richMenuId: string,
    imageBuffer: Buffer,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: new Uint8Array(imageBuffer),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to upload Rich Menu image: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Rich Menu image uploaded for ${richMenuId} (channel=${channel})`);
  }

  /**
   * Set default Rich Menu for all users
   */
  async setDefaultRichMenu(
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/all/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to set default Rich Menu: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Default Rich Menu set to ${richMenuId} (channel=${channel})`);
  }

  /**
   * Delete a Rich Menu
   */
  async deleteRichMenu(
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to delete Rich Menu: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Rich Menu deleted: ${richMenuId} (channel=${channel})`);
  }

  /**
   * List all Rich Menus
   */
  async listRichMenus(channel: 'shop' | 'finance' = 'shop'): Promise<unknown[]> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/richmenu/list`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to list Rich Menus: ${response.status}`);
    }
    const data = await response.json();
    return data.richmenus || [];
  }

  /**
   * Link a specific Rich Menu to a LINE user
   */
  async linkRichMenuToUser(
    userId: string,
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return;
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Failed to link Rich Menu to user ${userId}: ${response.status} ${errorBody}`,
      );
    }
    this.logger.log(`Rich Menu ${richMenuId} linked to user ${userId} (channel=${channel})`);
  }

  /**
   * Unlink Rich Menu from a LINE user (revert to default)
   */
  async unlinkRichMenuFromUser(
    userId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return;
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Failed to unlink Rich Menu from user ${userId}: ${response.status} ${errorBody}`,
      );
    }
    this.logger.log(`Rich Menu unlinked from user ${userId} (channel=${channel})`);
  }

  /**
   * Read a Rich Menu ID from SystemConfig by key
   */
  async getRichMenuIdFromConfig(key: string): Promise<string | null> {
    const config = await this.prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
    });
    return config?.value ?? null;
  }

  /**
   * Switch a LINE user's Rich Menu based on verification status and channel
   * Keys: line.richMenu.shopVerified | line.richMenu.shopDefault | line.richMenu.financeVerified | line.richMenu.financeDefault
   */
  async switchRichMenu(
    userId: string,
    isVerified: boolean,
    channel: 'shop' | 'finance',
  ): Promise<void> {
    const channelPart = channel === 'shop' ? 'shop' : 'finance';
    const statusPart = isVerified ? 'Verified' : 'Default';
    const key = `line.richMenu.${channelPart}${statusPart}`;

    const richMenuId = await this.getRichMenuIdFromConfig(key);
    if (!richMenuId) {
      this.logger.warn(`Rich Menu config not found for key "${key}" — skipping switch`);
      return;
    }

    await this.linkRichMenuToUser(userId, richMenuId, channel);
  }

  private async callLineApi(
    url: string,
    body: unknown,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<Response> {
    const token = await this.getChannelToken(channel);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

  /**
   * Set Rich Menu alias for a channel/variant combination.
   * Writes SystemConfig key `line.richMenu.{channel}{Variant}`.
   * For variant='default', also calls LINE setDefaultRichMenu (new friends see this menu).
   */
  async setRichMenuAlias(
    channel: 'shop' | 'finance',
    variant: 'default' | 'verified',
    richMenuId: string,
  ): Promise<void> {
    const variantPart = variant === 'default' ? 'Default' : 'Verified';
    const key = `line.richMenu.${channel}${variantPart}`;

    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: richMenuId },
      update: { value: richMenuId, deletedAt: null },
    });

    if (variant === 'default') {
      await this.setDefaultRichMenu(richMenuId, channel);
    }

    this.logger.log(`Rich Menu alias set: ${key} = ${richMenuId}`);
  }

  /**
   * Read all 4 Rich Menu aliases from SystemConfig.
   */
  async getRichMenuAliases(): Promise<{
    shopDefault: string | null;
    shopVerified: string | null;
    financeDefault: string | null;
    financeVerified: string | null;
  }> {
    const keys = [
      'line.richMenu.shopDefault',
      'line.richMenu.shopVerified',
      'line.richMenu.financeDefault',
      'line.richMenu.financeVerified',
    ];
    const records = await Promise.all(
      keys.map((key) =>
        this.prisma.systemConfig.findFirst({ where: { key, deletedAt: null } }),
      ),
    );
    return {
      shopDefault: records[0]?.value ?? null,
      shopVerified: records[1]?.value ?? null,
      financeDefault: records[2]?.value ?? null,
      financeVerified: records[3]?.value ?? null,
    };
  }
}
