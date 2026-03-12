import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PromptPay QR Code Generation Service
 * Generates Thai PromptPay QR codes for payment collection
 *
 * Uses the EMVCo QR Code standard for PromptPay
 * Reference: https://www.bot.or.th/Thai/PaymentSystems/PSServices/PromptPay
 */
@Injectable()
export class PromptPayQrService {
  private readonly logger = new Logger(PromptPayQrService.name);
  private promptPayId: string | undefined;
  private accountName: string | undefined;

  constructor(private configService: ConfigService) {
    this.promptPayId = this.configService.get<string>('PROMPTPAY_ID');
    this.accountName = this.configService.get<string>('PROMPTPAY_ACCOUNT_NAME');
  }

  reloadConfig(): void {
    // Will be called after DB config update; values loaded via ConfigService env
    // For DB-stored values, the controller passes them directly
  }

  setConfig(promptPayId: string, accountName: string): void {
    this.promptPayId = promptPayId;
    this.accountName = accountName;
  }

  /**
   * Generate PromptPay QR payload string (EMVCo format)
   * Can be used with any QR code library to generate the image
   */
  generatePayload(amount?: number): string {
    if (!this.promptPayId) {
      throw new Error('PROMPTPAY_ID not configured');
    }

    const id = this.promptPayId.replace(/[^0-9]/g, '');
    const isPhone = id.length <= 10;

    // Format the ID
    let formattedId: string;
    if (isPhone) {
      // Phone number: add country code 66, remove leading 0
      formattedId = '0066' + id.substring(1).padStart(9, '0');
    } else {
      // National ID or Tax ID (13 digits)
      formattedId = id;
    }

    // Build EMVCo QR Code payload
    const subTag = isPhone ? '01' : '02';
    const aid = '00' + this.tlv('00', 'A000000677010111') + this.tlv(subTag, formattedId);

    let payload = '';
    payload += this.tlv('00', '01'); // Payload Format Indicator
    payload += this.tlv('01', '12'); // Point of Initiation Method (12 = dynamic)
    payload += this.tlv('29', aid); // Merchant Account Information (PromptPay)
    payload += this.tlv('53', '764'); // Transaction Currency (THB = 764)
    payload += this.tlv('58', 'TH'); // Country Code

    if (amount && amount > 0) {
      payload += this.tlv('54', amount.toFixed(2)); // Transaction Amount
    }

    // Add CRC placeholder and calculate
    payload += '6304';
    const crc = this.crc16(payload);
    payload += crc;

    return payload;
  }

  /**
   * Generate QR code as base64 data URL
   * Uses a simple QR encoding - in production use 'qrcode' npm package
   */
  async generateQrDataUrl(amount?: number): Promise<string> {
    const payload = this.generatePayload(amount);

    try {
      // Try to use qrcode package if available
      const QRCode = await import('qrcode');
      return QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
    } catch {
      // If qrcode package not installed, return the payload string
      this.logger.warn('qrcode package not installed, returning raw payload');
      return payload;
    }
  }

  /**
   * Generate QR code as PNG buffer
   */
  async generateQrBuffer(amount?: number): Promise<Buffer> {
    const payload = this.generatePayload(amount);

    try {
      const QRCode = await import('qrcode');
      return QRCode.toBuffer(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
        type: 'png',
      });
    } catch {
      throw new Error('qrcode package not installed. Run: npm install qrcode @types/qrcode');
    }
  }

  getAccountName(): string {
    return this.accountName || '';
  }

  getMaskedPromptPayId(): string {
    if (!this.promptPayId) return '';
    const id = this.promptPayId;
    if (id.length <= 4) return id;
    return id.substring(0, 3) + '-****-' + id.substring(id.length - 4);
  }

  // ─── EMVCo QR Helpers ─────────────────────────────────

  private tlv(tag: string, value: string): string {
    const len = value.length.toString().padStart(2, '0');
    return tag + len + value;
  }

  private crc16(data: string): string {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc = crc << 1;
        }
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
}
