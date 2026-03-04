import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { OcrIdCardResult, OcrAddressStructured } from './dto/ocr.dto';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private anthropic: Anthropic | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('OCR service initialized with Anthropic API key');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not configured — OCR features will be unavailable');
    }
  }

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

  async extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    if (!this.anthropic) {
      throw new BadRequestException('ระบบ OCR ยังไม่พร้อมใช้งาน (ไม่ได้ตั้งค่า API Key)');
    }

    // Only accept base64 data URLs to prevent SSRF
    if (!imageBase64.startsWith('data:')) {
      throw new BadRequestException('รูปแบบไฟล์ไม่ถูกต้อง กรุณาส่งเป็น base64 data URL');
    }

    const prefixMatch = imageBase64.match(/^data:(image\/(jpeg|png|gif|webp));base64,/);
    if (!prefixMatch) {
      throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ กรุณาใช้ JPEG, PNG, GIF หรือ WebP');
    }

    const mediaType = prefixMatch[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = imageBase64.slice(prefixMatch[0].length);

    try {
      const response = await this.anthropic.messages.create({
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

      // Parse JSON from response — strip code fences and trailing commas
      let jsonText = textContent.text.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }
      // Remove trailing commas before } or ] (common LLM quirk)
      jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');

      const result = JSON.parse(jsonText);

      // Clean up nationalId - remove any dashes or spaces
      const rawNationalId = result.nationalId
        ? result.nationalId.replace(/[\s-]/g, '')
        : null;

      // Validate national ID checksum
      const nationalId =
        rawNationalId && this.validateNationalId(rawNationalId)
          ? rawNationalId
          : rawNationalId; // still return it even if checksum fails, frontend will warn

      // Validate dates
      const birthDate =
        result.birthDate && this.isValidDate(result.birthDate)
          ? result.birthDate
          : null;
      const issueDate =
        result.issueDate && this.isValidDate(result.issueDate)
          ? result.issueDate
          : null;
      const expiryDate =
        result.expiryDate && this.isValidDate(result.expiryDate)
          ? result.expiryDate
          : null;

      // Build structured address
      let addressStructured: OcrAddressStructured | null = null;
      if (result.addressStructured && typeof result.addressStructured === 'object') {
        const a = result.addressStructured;
        addressStructured = {
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
        // If all fields are empty, set to null
        const hasData = Object.values(addressStructured).some((v) => v !== '');
        if (!hasData) addressStructured = null;
      }

      return {
        nationalId,
        prefix: result.prefix || null,
        firstName: result.firstName || null,
        lastName: result.lastName || null,
        fullName: [result.firstName, result.lastName].filter(Boolean).join(' ') || null,
        birthDate,
        address: result.address || null,
        addressStructured,
        issueDate,
        expiryDate,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse OCR response as JSON', error.message);
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากบัตรประชาชนได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR ID card extraction failed', error.message);
      throw new BadRequestException('เกิดข้อผิดพลาดในการอ่านบัตรประชาชน: ' + (error.message || 'unknown'));
    }
  }
}
