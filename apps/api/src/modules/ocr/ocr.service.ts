import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { OcrIdCardResult } from './dto/ocr.dto';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private anthropic: Anthropic | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  async extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    if (!this.anthropic) {
      throw new BadRequestException('ระบบ OCR ยังไม่พร้อมใช้งาน (ไม่ได้ตั้งค่า API Key)');
    }

    // Only accept base64 data URLs to prevent SSRF
    if (!imageBase64.startsWith('data:')) {
      throw new BadRequestException('รูปแบบไฟล์ไม่ถูกต้อง กรุณาส่งเป็น base64 data URL');
    }

    const match = imageBase64.match(/^data:(image\/(jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ กรุณาใช้ JPEG, PNG, GIF หรือ WebP');
    }

    const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const base64Data = match[3];

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
  "firstName": "<ชื่อ>",
  "lastName": "<นามสกุล>",
  "birthDate": "<วันเกิด รูปแบบ YYYY-MM-DD เช่น 1990-01-15>",
  "address": "<ที่อยู่ตามบัตร ทั้งหมดรวมกัน>",
  "issueDate": "<วันออกบัตร รูปแบบ YYYY-MM-DD>",
  "expiryDate": "<วันหมดอายุ รูปแบบ YYYY-MM-DD>",
  "confidence": <ระดับความมั่นใจ 0.0-1.0>
}

หมายเหตุ:
- ให้แปลงวันที่จากพุทธศักราช (พ.ศ.) เป็นคริสต์ศักราช (ค.ศ.) โดยลบ 543 ออก
- ถ้าอ่านข้อมูลไม่ได้ให้ใส่ null
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

      // Parse JSON from response
      let jsonText = textContent.text.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const result = JSON.parse(jsonText);

      // Clean up nationalId - remove any dashes or spaces
      const nationalId = result.nationalId
        ? result.nationalId.replace(/[\s-]/g, '')
        : null;

      return {
        nationalId,
        prefix: result.prefix || null,
        firstName: result.firstName || null,
        lastName: result.lastName || null,
        fullName: [result.firstName, result.lastName].filter(Boolean).join(' ') || null,
        birthDate: result.birthDate || null,
        address: result.address || null,
        issueDate: result.issueDate || null,
        expiryDate: result.expiryDate || null,
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
