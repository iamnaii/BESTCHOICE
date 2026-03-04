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

  private static readonly OCR_SYSTEM_PROMPT =
    'คุณเป็นผู้เชี่ยวชาญด้าน OCR สำหรับเอกสารไทย มีความแม่นยำสูงสุดในการอ่านตัวอักษรไทยและตัวเลขจากรูปถ่ายเอกสาร ' +
    'ให้พยายามอ่านข้อมูลทุกตัวอักษรอย่างระมัดระวัง แม้รูปจะเบลอหรือมีแสงสะท้อน ' +
    'ถ้าตัวอักษรไม่ชัด ให้ใช้บริบทรอบข้างช่วยในการตีความ เช่น รูปแบบเลขบัตรประชาชน 13 หลัก หรือชื่อธนาคารที่คุ้นเคย ' +
    'ตอบเป็น JSON เท่านั้น ห้ามมี markdown code block หรือข้อความอื่นใดนอกเหนือจาก JSON';

  private static readonly OCR_MODEL = 'claude-sonnet-4-20250514';
  private static readonly LOW_CONFIDENCE_THRESHOLD = 0.7;
  private static readonly MAX_RETRIES = 2;

  private static readonly THAI_PROVINCES: readonly string[] = [
    'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร',
    'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
    'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง',
    'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
    'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส',
    'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
    'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา',
    'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์',
    'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน',
    'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง',
    'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย',
    'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
    'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
    'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย',
    'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์',
    'อุทัยธานี', 'อุบลราชธานี',
  ];

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

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private findClosestProvince(input: string): string {
    // Strip common prefixes
    const cleaned = input.replace(/^(จังหวัด|จ\.|จ\s)/g, '').trim();
    if (!cleaned) return input;

    // Exact match
    if (OcrService.THAI_PROVINCES.includes(cleaned)) return cleaned;

    // Fuzzy match
    let bestMatch = cleaned;
    let bestDistance = Infinity;
    const maxDistance = Math.max(2, Math.floor(cleaned.length * 0.3));

    for (const province of OcrService.THAI_PROVINCES) {
      const distance = this.levenshteinDistance(cleaned, province);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = province;
      }
    }

    if (bestDistance <= maxDistance) {
      if (bestDistance > 0) {
        this.logger.log(`Province corrected: "${cleaned}" → "${bestMatch}" (distance: ${bestDistance})`);
      }
      return bestMatch;
    }

    return cleaned;
  }

  private buildAddressStructured(raw: unknown): OcrAddressStructured | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, string>;

    const rawSubdistrict = (a.subdistrict || '').trim();
    const rawDistrict = (a.district || '').trim();
    const rawProvince = (a.province || '').trim();

    const structured: OcrAddressStructured = {
      houseNo: (a.houseNo || '').trim(),
      moo: (a.moo || '').trim().replace(/^(หมู่ที่|หมู่|ม\.)\s*/g, ''),
      village: (a.village || '').trim(),
      soi: (a.soi || '').trim().replace(/^(ซอย|ซ\.)\s*/g, ''),
      road: (a.road || '').trim().replace(/^(ถนน|ถ\.)\s*/g, ''),
      subdistrict: rawSubdistrict,
      district: rawDistrict,
      province: rawProvince ? this.findClosestProvince(rawProvince) : '',
      postalCode: /^\d{5}$/.test((a.postalCode || '').trim()) ? a.postalCode.trim() : '',
    };
    const hasData = Object.values(structured).some((v) => v !== '');
    return hasData ? structured : null;
  }

  private ensureAnthropicReady(): void {
    if (!this.anthropic) {
      throw new BadRequestException('ระบบ OCR ยังไม่พร้อมใช้งาน (ไม่ได้ตั้งค่า API Key)');
    }
  }

  private async callClaudeOcr(
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    base64Data: string,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.anthropic!.messages.create({
      model: OcrService.OCR_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: OcrService.OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return this.parseJsonResponse(textContent.text) as Record<string, unknown>;
  }

  private async callClaudeOcrWithRetry(
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    base64Data: string,
    prompt: string,
    retryPrompt: string,
  ): Promise<Record<string, unknown>> {
    let bestResult = await this.callClaudeOcr(mediaType, base64Data, prompt);
    const confidence = Number(bestResult.confidence) || 0;

    if (confidence < OcrService.LOW_CONFIDENCE_THRESHOLD) {
      this.logger.warn(`Low confidence (${confidence.toFixed(2)}), retrying with enhanced prompt`);
      for (let attempt = 0; attempt < OcrService.MAX_RETRIES; attempt++) {
        try {
          const retryResult = await this.callClaudeOcr(mediaType, base64Data, retryPrompt);
          const retryConfidence = Number(retryResult.confidence) || 0;
          if (retryConfidence > confidence) {
            bestResult = retryResult;
            break;
          }
        } catch {
          this.logger.warn(`Retry attempt ${attempt + 1} failed`);
        }
      }
    }

    return bestResult;
  }

  // ─── 1. Extract ID Card ─────────────────────────────────

  async extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    this.ensureAnthropicReady();
    const { mediaType, base64Data } = this.validateImageBase64(imageBase64);

    const basePrompt = `อ่านข้อมูลจากบัตรประชาชนไทยในรูปนี้อย่างละเอียด ตอบเป็น JSON ตามรูปแบบนี้:
{
  "nationalId": "<เลขบัตรประชาชน 13 หลัก ไม่มีขีด>",
  "prefix": "<คำนำหน้า เช่น นาย, นาง, นางสาว>",
  "firstName": "<ชื่อ (ภาษาไทย)>",
  "lastName": "<นามสกุล (ภาษาไทย)>",
  "birthDate": "<วันเกิด รูปแบบ YYYY-MM-DD>",
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

คำแนะนำสำคัญ:
- เลขบัตรประชาชน 13 หลักอยู่ด้านบนของบัตร อ่านทีละหลักอย่างระมัดระวัง
- ชื่อ-นามสกุลอยู่ตรงกลางบัตร มีทั้งภาษาไทยและภาษาอังกฤษ ให้อ่านภาษาไทย
- แปลงวันที่จาก พ.ศ. เป็น ค.ศ. โดยลบ 543

วิธีอ่านที่อยู่ (สำคัญมาก):
- ที่อยู่อยู่ด้านล่างใต้ชื่อ พิมพ์ 2-3 บรรทัด ตัวเล็ก ต้องอ่านอย่างระมัดระวัง
- อ่านจากซ้ายไปขวา บนลงล่าง ทุกบรรทัด
- บ้านเลขที่ อาจมี / เช่น 11/2 หรือ 123/45
- หมู่ (moo) มักมีคำว่า "หมู่ที่" หรือ "ม." นำหน้า → เก็บเฉพาะตัวเลข
- ซอย/ถนน → เก็บเฉพาะชื่อ ไม่ต้องมีคำว่า ซ. ถ. นำหน้า
- ตำบล/แขวง → เก็บคำนำหน้าไว้ด้วย เช่น "ตำบลท่าทอง" หรือ "แขวงดุสิต"
- อำเภอ/เขต → เก็บคำนำหน้าไว้ด้วย เช่น "อำเภอเมืองลพบุรี" หรือ "เขตพระนคร"
- จังหวัด → ตัดคำนำหน้า จ. ออก เก็บเฉพาะชื่อจังหวัด (ต้องเป็น 1 ใน 77 จังหวัดของไทย)
- รหัสไปรษณีย์ 5 หลัก มักอยู่ท้ายสุดของที่อยู่
- ถ้าอ่านไม่ได้ให้ใส่ null`;

    const retryPrompt = `กรุณาอ่านบัตรประชาชนไทยนี้อีกครั้งอย่างละเอียดที่สุด:

1. ดูเลขบัตรประชาชน 13 หลักที่ด้านบน — อ่านทีละตัวเลข ระวังเลขที่คล้ายกัน เช่น 1/7, 3/8, 5/6, 0/8
2. ชื่อ-นามสกุล — ดูทั้งภาษาไทยและอังกฤษ ใช้ประกอบกันเพื่อความแม่นยำ
3. วันเดือนปีเกิด — ระวังการแปลง พ.ศ. เป็น ค.ศ. (ลบ 543)
4. ที่อยู่ (สำคัญมาก — ต้องอ่านทุกตัวอักษร):
   - ซูมเข้าไปดูที่อยู่ด้านล่างใต้ชื่อ อ่านทีละบรรทัด
   - บ้านเลขที่ หมู่ ซอย ถนน — อ่านตัวเลขทุกตัว
   - ตำบล/แขวง อำเภอ/เขต จังหวัด — อ่านทุกพยางค์ ระวังสระ/วรรณยุกต์ที่คล้ายกัน
   - จังหวัดต้องเป็น 1 ใน 77 จังหวัดของไทย
   - รหัสไปรษณีย์ 5 หลัก — มักอยู่ท้ายสุด
5. วันออกบัตร/หมดอายุ — อยู่ด้านล่างสุด

ตอบ JSON:
${basePrompt.split('ตอบเป็น JSON ตามรูปแบบนี้:')[1]}`;

    try {
      const result = await this.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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

    const basePrompt = `อ่านสลิปการโอนเงิน/ชำระเงินจากธนาคารไทยในรูปนี้ ตอบเป็น JSON:
{
  "amount": <จำนวนเงิน เป็นตัวเลข เช่น 5000.00>,
  "senderName": "<ชื่อผู้โอน>",
  "senderBank": "<ธนาคารผู้โอน>",
  "senderAccountNo": "<เลขบัญชีผู้โอน>",
  "receiverName": "<ชื่อผู้รับ>",
  "receiverBank": "<ธนาคารผู้รับ>",
  "receiverAccountNo": "<เลขบัญชีผู้รับ หรือเบอร์พร้อมเพย์>",
  "transactionRef": "<หมายเลขอ้างอิง/เลขที่รายการ>",
  "transactionDate": "<วันที่โอน YYYY-MM-DD>",
  "transactionTime": "<เวลาที่โอน HH:mm>",
  "slipType": "<BANK_TRANSFER | QR_PAYMENT | PROMPTPAY | OTHER>",
  "confidence": <0.0-1.0>
}

คำแนะนำสำคัญ:
- จำนวนเงินมักจะเป็นตัวเลขใหญ่ที่เด่นชัดที่สุดในสลิป อ่านอย่างระมัดระวังรวมถึงจุดทศนิยม
- ชื่อผู้โอน/ผู้รับ อาจมีทั้งไทยและอังกฤษ ให้ใช้ชื่อที่อ่านได้ชัดที่สุด
- เลขบัญชีอาจถูกบดบังบางส่วน (xxx) ให้ใส่ตามที่เห็น
- หมายเลขอ้างอิงมักอยู่ด้านล่างของสลิป
- แปลงวันที่จาก พ.ศ. เป็น ค.ศ. (ลบ 543)
- จำนวนเงินเป็นตัวเลขเท่านั้น ไม่มี , หรือ ฿
- ถ้าอ่านไม่ได้ให้ใส่ null`;

    const retryPrompt = `กรุณาอ่านสลิปโอนเงินนี้อีกครั้งอย่างละเอียด:
1. จำนวนเงิน — อ่านตัวเลขทุกหลักรวมทศนิยม
2. ชื่อผู้โอน/ผู้รับ — อ่านทั้งภาษาไทยและอังกฤษ
3. เลขบัญชี — อ่านทุกหลักที่เห็นได้
4. วันเวลา — ระวัง พ.ศ./ค.ศ.
5. หมายเลขอ้างอิง — ดูด้านล่างของสลิป

${basePrompt}`;

    try {
      const result = await this.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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

    const basePrompt = `อ่านข้อมูลจากหน้าสมุดบัญชีธนาคาร (Book Bank / Passbook) ไทยในรูปนี้ ตอบเป็น JSON:
{
  "accountName": "<ชื่อเจ้าของบัญชี>",
  "accountNo": "<เลขที่บัญชี ไม่มีขีด>",
  "bankName": "<ชื่อธนาคาร>",
  "branchName": "<ชื่อสาขา>",
  "accountType": "<ประเภทบัญชี เช่น ออมทรัพย์, กระแสรายวัน, ฝากประจำ>",
  "balance": <ยอดเงินคงเหลือ เป็นตัวเลข หรือ null>,
  "lastTransactionDate": "<YYYY-MM-DD หรือ null>",
  "confidence": <0.0-1.0>
}

คำแนะนำสำคัญ:
- ชื่อธนาคารดูจากโลโก้และข้อความด้านบน (กสิกรไทย, กรุงเทพ, ไทยพาณิชย์, กรุงไทย, ทหารไทยธนชาต, ออมสิน, กรุงศรีอยุธยา, เกียรตินาคินภัทร ฯลฯ)
- เลขบัญชีมักอยู่ตรงกลางหรือด้านบน อ่านทุกหลักอย่างระมัดระวัง ไม่ต้องมีขีดหรือเว้นวรรค
- ชื่อเจ้าของบัญชีอาจเป็นภาษาไทยหรืออังกฤษ ให้อ่านภาษาไทยเป็นหลัก
- แปลงวันที่จาก พ.ศ. เป็น ค.ศ. (ลบ 543)
- ยอดเงินเป็นตัวเลขเท่านั้น ไม่มี , หรือ ฿
- ถ้าอ่านไม่ได้ให้ใส่ null`;

    const retryPrompt = `กรุณาอ่านสมุดบัญชีนี้อีกครั้ง พิจารณา:
1. โลโก้/สีของธนาคาร ช่วยระบุชื่อธนาคาร
2. เลขบัญชี — อ่านทีละตัวเลข ระวัง 0/8, 1/7, 3/8
3. ชื่อเจ้าของ — ดูทั้งไทยและอังกฤษ
4. ประเภทบัญชี — มักระบุไว้ใกล้เลขบัญชี

${basePrompt}`;

    try {
      const result = await this.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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

    const basePrompt = `อ่านข้อมูลจากใบขับขี่ไทยในรูปนี้อย่างละเอียด ตอบเป็น JSON:
{
  "licenseNo": "<เลขที่ใบขับขี่>",
  "nationalId": "<เลขบัตรประชาชน 13 หลัก ไม่มีขีด>",
  "prefix": "<คำนำหน้า เช่น นาย, นาง, นางสาว>",
  "firstName": "<ชื่อ (ภาษาไทย)>",
  "lastName": "<นามสกุล (ภาษาไทย)>",
  "birthDate": "<วันเกิด YYYY-MM-DD>",
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
  "licenseType": "<ประเภท เช่น ส่วนบุคคล, สาธารณะ, ชั่วคราว, ตลอดชีพ>",
  "issueDate": "<วันออกใบขับขี่ YYYY-MM-DD>",
  "expiryDate": "<วันหมดอายุ YYYY-MM-DD>",
  "bloodType": "<กรุ๊ปเลือด A, B, O, AB>",
  "confidence": <0.0-1.0>
}

คำแนะนำสำคัญ:
- เลขที่ใบขับขี่อยู่ด้านบน อ่านทุกหลักอย่างระมัดระวัง
- เลขบัตรประชาชน 13 หลักอยู่ใต้เลขใบขับขี่
- ชื่อ-นามสกุลมีทั้งไทยและอังกฤษ ให้ใช้ประกอบกัน
- แปลงวันที่จาก พ.ศ. เป็น ค.ศ. (ลบ 543)

วิธีอ่านที่อยู่ (สำคัญมาก):
- ที่อยู่พิมพ์ตัวเล็ก อ่านทีละบรรทัดอย่างระมัดระวัง
- หมู่ (moo) → เก็บเฉพาะตัวเลข
- ตำบล/แขวง → เก็บคำนำหน้าไว้ด้วย เช่น "ตำบลท่าทอง" หรือ "แขวงดุสิต"
- อำเภอ/เขต → เก็บคำนำหน้าไว้ด้วย เช่น "อำเภอเมืองลพบุรี" หรือ "เขตพระนคร"
- จังหวัด → ตัดคำนำหน้า จ. ออก (ต้องเป็น 1 ใน 77 จังหวัดของไทย)
- รหัสไปรษณีย์ 5 หลัก
- ถ้าอ่านไม่ได้ให้ใส่ null`;

    const retryPrompt = `กรุณาอ่านใบขับขี่ไทยนี้อีกครั้งอย่างละเอียดที่สุด:
1. เลขใบขับขี่ — มักอยู่มุมบนขวา
2. เลขบัตรประชาชน 13 หลัก — อ่านทีละตัว ระวัง 0/8, 1/7
3. ชื่อ — ดูทั้งภาษาไทยและอังกฤษประกอบกัน
4. ที่อยู่ (สำคัญมาก — อ่านทุกตัวอักษร):
   - อ่านทีละบรรทัด บ้านเลขที่ หมู่ ซอย ถนน
   - ตำบล/แขวง อำเภอ/เขต จังหวัด — อ่านทุกพยางค์
   - จังหวัดต้องเป็น 1 ใน 77 จังหวัดของไทย
   - รหัสไปรษณีย์ 5 หลัก
5. วันเดือนปี — แปลง พ.ศ. เป็น ค.ศ. อย่างระมัดระวัง
6. กรุ๊ปเลือด — มักอยู่ด้านล่าง

${basePrompt}`;

    try {
      const result = await this.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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
