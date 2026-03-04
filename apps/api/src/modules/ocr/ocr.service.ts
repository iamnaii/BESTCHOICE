import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  OcrIdCardResult,
  OcrAddressStructured,
  OcrPaymentSlipResult,
  OcrBookBankResult,
  OcrDrivingLicenseResult,
} from './dto/ocr.dto';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private anthropic: Anthropic | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = (
      this.configService.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey, timeout: 90_000 });
      this.logger.log('OCR service initialized with Anthropic API key');
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY not configured — OCR features will be unavailable. ' +
        'Set ANTHROPIC_API_KEY in .env file at project root or as environment variable.',
      );
    }
  }

  // ─── Shared Helpers ─────────────────────────────────────

  private validateNationalId(id: string): boolean {
    if (!/^\d{13}$/.test(id)) return false;
    const digits = id.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += digits[i] * (13 - i);
    }
    const checkDigit = (11 - (sum % 11)) % 10;
    return checkDigit === digits[12];
  }

  private isValidDate(dateStr: string): boolean {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const [, y, m, d] = match.map(Number);
    const date = new Date(y, m - 1, d);
    return (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    );
  }

  private validateImageBase64(imageBase64: string): { mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; base64Data: string } {
    if (!imageBase64.startsWith('data:')) {
      throw new BadRequestException('รูปแบบไฟล์ไม่ถูกต้อง กรุณาส่งเป็น base64 data URL');
    }

    const prefixMatch = imageBase64.match(/^data:(image\/(jpeg|png|gif|webp));base64,/);
    if (!prefixMatch) {
      throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ กรุณาใช้ JPEG, PNG, GIF หรือ WebP');
    }

    const mediaType = prefixMatch[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = imageBase64.slice(prefixMatch[0].length);

    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      throw new BadRequestException('ข้อมูลรูปภาพไม่ถูกต้อง (base64 ไม่ valid)');
    }

    return { mediaType, base64Data };
  }

  private parseJsonResponse(rawText: string): unknown {
    let jsonText = rawText.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }
    // Remove trailing commas before } or ]
    jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(jsonText);
  }

  private buildAddressStructured(raw: unknown): OcrAddressStructured | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, string>;
    const structured: OcrAddressStructured = {
      houseNo: (a.houseNo || '').trim(),
      moo: (a.moo || '').trim(),
      village: (a.village || '').trim(),
      soi: (a.soi || '').trim(),
      road: (a.road || '').trim(),
      subdistrict: (a.subdistrict || '').trim(),
      district: (a.district || '').trim(),
      province: (a.province || '').trim(),
      postalCode: (a.postalCode || '').trim(),
    };
    const hasData = Object.values(structured).some((v) => v !== '');
    return hasData ? structured : null;
  }

  private ensureAnthropicReady(): void {
    if (!this.anthropic) {
      throw new BadRequestException('ระบบ OCR ยังไม่พร้อมใช้งาน (ไม่ได้ตั้งค่า API Key)');
    }
  }

  // ─── 1. Extract ID Card ─────────────────────────────────

  async extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    this.ensureAnthropicReady();
    const { mediaType, base64Data } = this.validateImageBase64(imageBase64);

    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: `นี่คือรูปบัตรประชาชนไทย กรุณาอ่านข้อมูลจากบัตรและตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "nationalId": "<เลขบัตรประชาชน 13 หลัก ไม่มีขีด เช่น 1234567890123>",
  "prefix": "<คำนำหน้า เช่น นาย, นาง, นางสาว>",
  "firstName": "<ชื่อ (ภาษาไทย)>",
  "lastName": "<นามสกุล (ภาษาไทย)>",
  "birthDate": "<วันเกิด รูปแบบ YYYY-MM-DD เช่น 1990-01-15>",
  "address": "<ที่อยู่ตามบัตร ทั้งหมดรวมกัน>",
  "addressStructured": {
    "houseNo": "<บ้านเลขที่>",
    "moo": "<หมู่>",
    "village": "<หมู่บ้าน/อาคาร>",
    "soi": "<ซอย>",
    "road": "<ถนน>",
    "subdistrict": "<ตำบล/แขวง>",
    "district": "<อำเภอ/เขต>",
    "province": "<จังหวัด>",
    "postalCode": "<รหัสไปรษณีย์ 5 หลัก>"
  },
  "issueDate": "<วันออกบัตร รูปแบบ YYYY-MM-DD>",
  "expiryDate": "<วันหมดอายุ รูปแบบ YYYY-MM-DD>",
  "confidence": <ระดับความมั่นใจ 0.0-1.0>
}

หมายเหตุ:
- ให้แปลงวันที่จากพุทธศักราช (พ.ศ.) เป็นคริสต์ศักราช (ค.ศ.) โดยลบ 543 ออก
- ถ้าอ่านข้อมูลไม่ได้ให้ใส่ null หรือ "" สำหรับ field ใน addressStructured
- ตำบล/แขวง ไม่ต้องมีคำนำหน้า "ตำบล" หรือ "แขวง" เช่น ใส่แค่ "บางรัก"
- อำเภอ/เขต ไม่ต้องมีคำนำหน้า "อำเภอ" หรือ "เขต" เช่น ใส่แค่ "เมือง"
- จังหวัด ไม่ต้องมีคำนำหน้า "จังหวัด" เช่น ใส่แค่ "กรุงเทพมหานคร"
- ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const result = this.parseJsonResponse(textContent.text) as Record<string, unknown>;

      const rawNationalId = result.nationalId
        ? String(result.nationalId).replace(/[\s-]/g, '')
        : null;

      const nationalIdValid = rawNationalId ? this.validateNationalId(rawNationalId) : false;

      const birthDate =
        result.birthDate && this.isValidDate(String(result.birthDate))
          ? String(result.birthDate)
          : null;
      const issueDate =
        result.issueDate && this.isValidDate(String(result.issueDate))
          ? String(result.issueDate)
          : null;
      const expiryDate =
        result.expiryDate && this.isValidDate(String(result.expiryDate))
          ? String(result.expiryDate)
          : null;

      const addressStructured = this.buildAddressStructured(result.addressStructured);

      return {
        nationalId: rawNationalId,
        nationalIdValid,
        prefix: (result.prefix as string) || null,
        firstName: (result.firstName as string) || null,
        lastName: (result.lastName as string) || null,
        fullName: [result.firstName, result.lastName].filter(Boolean).join(' ') || null,
        birthDate,
        address: (result.address as string) || null,
        addressStructured,
        issueDate,
        expiryDate,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse OCR response as JSON');
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากบัตรประชาชนได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR ID card extraction failed');
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ─── 2. Extract Payment Slip ────────────────────────────

  async extractPaymentSlip(imageBase64: string): Promise<OcrPaymentSlipResult> {
    this.ensureAnthropicReady();
    const { mediaType, base64Data } = this.validateImageBase64(imageBase64);

    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: `นี่คือสลิปการโอนเงิน/สลิปชำระเงินจากธนาคารในประเทศไทย กรุณาอ่านข้อมูลจากสลิปและตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "amount": <จำนวนเงินที่โอน เป็นตัวเลข เช่น 5000.00>,
  "senderName": "<ชื่อผู้โอน>",
  "senderBank": "<ธนาคารผู้โอน เช่น กสิกร, กรุงเทพ, ไทยพาณิชย์, กรุงไทย, ทหารไทยธนชาต>",
  "senderAccountNo": "<เลขบัญชีผู้โอน>",
  "receiverName": "<ชื่อผู้รับ>",
  "receiverBank": "<ธนาคารผู้รับ>",
  "receiverAccountNo": "<เลขบัญชีผู้รับ หรือเบอร์พร้อมเพย์>",
  "transactionRef": "<หมายเลขอ้างอิง/เลขที่รายการ>",
  "transactionDate": "<วันที่โอน รูปแบบ YYYY-MM-DD>",
  "transactionTime": "<เวลาที่โอน รูปแบบ HH:mm>",
  "slipType": "<ประเภท: BANK_TRANSFER, QR_PAYMENT, PROMPTPAY, OTHER>",
  "confidence": <ระดับความมั่นใจ 0.0-1.0>
}

หมายเหตุ:
- ให้แปลงวันที่จากพุทธศักราช (พ.ศ.) เป็นคริสต์ศักราช (ค.ศ.) โดยลบ 543 ออก
- ถ้าอ่านข้อมูลใดไม่ได้ให้ใส่ null
- ถ้าเป็น PromptPay ให้ใส่เลขพร้อมเพย์ใน receiverAccountNo
- ถ้าสลิปเป็น QR Payment ให้ใส่ slipType เป็น QR_PAYMENT
- จำนวนเงินต้องเป็นตัวเลขเท่านั้น ไม่ต้องมีเครื่องหมาย , หรือ ฿
- ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const result = this.parseJsonResponse(textContent.text) as Record<string, unknown>;

      // Parse and validate amount
      let amount: number | null = null;
      if (result.amount != null) {
        const parsed = typeof result.amount === 'string'
          ? parseFloat(String(result.amount).replace(/[,฿\s]/g, ''))
          : Number(result.amount);
        if (!isNaN(parsed) && parsed > 0) {
          amount = Math.round(parsed * 100) / 100;
        }
      }

      // Validate date
      const transactionDate = result.transactionDate && this.isValidDate(String(result.transactionDate))
        ? String(result.transactionDate)
        : null;

      // Validate time format HH:mm
      let transactionTime: string | null = null;
      if (result.transactionTime) {
        const timeStr = String(result.transactionTime);
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(timeStr)) {
          transactionTime = timeStr.substring(0, 5); // Always HH:mm
        }
      }

      // Validate slipType
      const validSlipTypes = ['BANK_TRANSFER', 'QR_PAYMENT', 'PROMPTPAY', 'OTHER'];
      const slipType = validSlipTypes.includes(String(result.slipType))
        ? String(result.slipType) as OcrPaymentSlipResult['slipType']
        : null;

      return {
        amount,
        senderName: (result.senderName as string) || null,
        senderBank: (result.senderBank as string) || null,
        senderAccountNo: (result.senderAccountNo as string) || null,
        receiverName: (result.receiverName as string) || null,
        receiverBank: (result.receiverBank as string) || null,
        receiverAccountNo: (result.receiverAccountNo as string) || null,
        transactionRef: (result.transactionRef as string) || null,
        transactionDate,
        transactionTime,
        slipType,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse payment slip OCR response as JSON');
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากสลิปได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR payment slip extraction failed');
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ─── 3. Extract Book Bank ───────────────────────────────

  async extractBookBank(imageBase64: string): Promise<OcrBookBankResult> {
    this.ensureAnthropicReady();
    const { mediaType, base64Data } = this.validateImageBase64(imageBase64);

    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: `นี่คือรูปหน้าสมุดบัญชีธนาคาร (Book Bank / Passbook) ของธนาคารในประเทศไทย กรุณาอ่านข้อมูลและตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "accountName": "<ชื่อเจ้าของบัญชี>",
  "accountNo": "<เลขที่บัญชี ไม่มีขีด>",
  "bankName": "<ชื่อธนาคาร เช่น กสิกรไทย, กรุงเทพ, ไทยพาณิชย์, กรุงไทย, ทหารไทยธนชาต, ออมสิน, กรุงศรีอยุธยา>",
  "branchName": "<ชื่อสาขา>",
  "accountType": "<ประเภทบัญชี เช่น ออมทรัพย์, กระแสรายวัน, ฝากประจำ>",
  "balance": <ยอดเงินคงเหลือ เป็นตัวเลข หรือ null ถ้าไม่มี>,
  "lastTransactionDate": "<วันที่ทำรายการล่าสุด รูปแบบ YYYY-MM-DD หรือ null>",
  "confidence": <ระดับความมั่นใจ 0.0-1.0>
}

หมายเหตุ:
- ให้แปลงวันที่จากพุทธศักราช (พ.ศ.) เป็นคริสต์ศักราช (ค.ศ.) โดยลบ 543 ออก
- ถ้าอ่านข้อมูลใดไม่ได้ให้ใส่ null
- เลขที่บัญชีไม่ต้องมีขีดหรือเว้นวรรค
- ยอดเงินต้องเป็นตัวเลขเท่านั้น ไม่ต้องมีเครื่องหมาย , หรือ ฿
- ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const result = this.parseJsonResponse(textContent.text) as Record<string, unknown>;

      // Parse balance
      let balance: number | null = null;
      if (result.balance != null) {
        const parsed = typeof result.balance === 'string'
          ? parseFloat(String(result.balance).replace(/[,฿\s]/g, ''))
          : Number(result.balance);
        if (!isNaN(parsed)) {
          balance = Math.round(parsed * 100) / 100;
        }
      }

      // Clean account number
      const accountNo = result.accountNo
        ? String(result.accountNo).replace(/[\s-]/g, '')
        : null;

      // Validate date
      const lastTransactionDate = result.lastTransactionDate && this.isValidDate(String(result.lastTransactionDate))
        ? String(result.lastTransactionDate)
        : null;

      return {
        accountName: (result.accountName as string) || null,
        accountNo,
        bankName: (result.bankName as string) || null,
        branchName: (result.branchName as string) || null,
        accountType: (result.accountType as string) || null,
        balance,
        lastTransactionDate,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse book bank OCR response as JSON');
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากสมุดบัญชีได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR book bank extraction failed');
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ─── 4. Extract Driving License ─────────────────────────

  async extractDrivingLicense(imageBase64: string): Promise<OcrDrivingLicenseResult> {
    this.ensureAnthropicReady();
    const { mediaType, base64Data } = this.validateImageBase64(imageBase64);

    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: `นี่คือรูปใบขับขี่ (Driving License) ของประเทศไทย กรุณาอ่านข้อมูลและตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "licenseNo": "<เลขที่ใบขับขี่>",
  "nationalId": "<เลขบัตรประชาชน 13 หลัก ไม่มีขีด>",
  "prefix": "<คำนำหน้า เช่น นาย, นาง, นางสาว>",
  "firstName": "<ชื่อ (ภาษาไทย)>",
  "lastName": "<นามสกุล (ภาษาไทย)>",
  "birthDate": "<วันเกิด รูปแบบ YYYY-MM-DD>",
  "address": "<ที่อยู่ทั้งหมดรวมกัน>",
  "addressStructured": {
    "houseNo": "<บ้านเลขที่>",
    "moo": "<หมู่>",
    "village": "<หมู่บ้าน/อาคาร>",
    "soi": "<ซอย>",
    "road": "<ถนน>",
    "subdistrict": "<ตำบล/แขวง>",
    "district": "<อำเภอ/เขต>",
    "province": "<จังหวัด>",
    "postalCode": "<รหัสไปรษณีย์ 5 หลัก>"
  },
  "licenseType": "<ประเภทใบขับขี่ เช่น ส่วนบุคคล, สาธารณะ, ชั่วคราว, ตลอดชีพ>",
  "issueDate": "<วันออกใบขับขี่ รูปแบบ YYYY-MM-DD>",
  "expiryDate": "<วันหมดอายุ รูปแบบ YYYY-MM-DD>",
  "bloodType": "<กรุ๊ปเลือด เช่น A, B, O, AB>",
  "confidence": <ระดับความมั่นใจ 0.0-1.0>
}

หมายเหตุ:
- ให้แปลงวันที่จากพุทธศักราช (พ.ศ.) เป็นคริสต์ศักราช (ค.ศ.) โดยลบ 543 ออก
- ถ้าอ่านข้อมูลใดไม่ได้ให้ใส่ null หรือ "" สำหรับ field ใน addressStructured
- ตำบล/แขวง ไม่ต้องมีคำนำหน้า "ตำบล" หรือ "แขวง"
- อำเภอ/เขต ไม่ต้องมีคำนำหน้า "อำเภอ" หรือ "เขต"
- จังหวัด ไม่ต้องมีคำนำหน้า "จังหวัด"
- ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const result = this.parseJsonResponse(textContent.text) as Record<string, unknown>;

      const rawNationalId = result.nationalId
        ? String(result.nationalId).replace(/[\s-]/g, '')
        : null;
      const nationalIdValid = rawNationalId ? this.validateNationalId(rawNationalId) : false;

      const birthDate = result.birthDate && this.isValidDate(String(result.birthDate))
        ? String(result.birthDate) : null;
      const issueDate = result.issueDate && this.isValidDate(String(result.issueDate))
        ? String(result.issueDate) : null;
      const expiryDate = result.expiryDate && this.isValidDate(String(result.expiryDate))
        ? String(result.expiryDate) : null;

      const addressStructured = this.buildAddressStructured(result.addressStructured);

      return {
        licenseNo: (result.licenseNo as string) || null,
        nationalId: rawNationalId,
        nationalIdValid,
        prefix: (result.prefix as string) || null,
        firstName: (result.firstName as string) || null,
        lastName: (result.lastName as string) || null,
        fullName: [result.firstName, result.lastName].filter(Boolean).join(' ') || null,
        birthDate,
        address: (result.address as string) || null,
        addressStructured,
        licenseType: (result.licenseType as string) || null,
        issueDate,
        expiryDate,
        bloodType: (result.bloodType as string) || null,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse driving license OCR response as JSON');
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากใบขับขี่ได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR driving license extraction failed');
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }
}
