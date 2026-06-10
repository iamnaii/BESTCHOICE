import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AnthropicOcrClient } from './anthropic-ocr.client';
import {
  validateNationalId,
  isValidDate,
  validateImageBase64,
  validateFileBase64,
  buildAddressStructured,
} from './ocr-parsing.util';
import {
  OcrIdCardResult,
  OcrPaymentSlipResult,
  OcrBookBankResult,
  OcrDrivingLicenseResult,
  OcrSalarySlipResult,
  OcrBankStatementResult,
} from '../dto/ocr.dto';

@Injectable()
export class OcrExtractorsService {
  private readonly logger = new Logger(OcrExtractorsService.name);

  constructor(private client: AnthropicOcrClient) {}

  // ─── 0. Generate Template HTML from File ───────────────

  private static readonly TEMPLATE_GENERATION_PROMPT = `คุณเป็นผู้เชี่ยวชาญด้านการสร้างเทมเพลต HTML สำหรับสัญญาผ่อนชำระสินค้า (ร้านขายมือถือในประเทศไทย)

ให้อ่านเอกสารนี้แล้วสร้าง HTML template ที่มีโครงสร้างเหมือนเอกสารต้นฉบับให้มากที่สุด

กฎสำคัญ:
1. ใช้ placeholders เหล่านี้แทนข้อมูลจริง (ใส่เฉพาะที่เหมาะสมตามเนื้อหาในเอกสาร):
   - ข้อมูลสัญญา: {contract_number}, {contract_date}, {contract_date_day}, {contract_date_month}, {contract_date_year}
   - ข้อมูลลูกค้า: {customer_name}, {customer_prefix}, {national_id}, {customer_phone}, {customer_phone_secondary}, {customer_address}, {customer_address_id_card}, {customer_address_current}, {customer_zipcode}, {customer_line_id}, {customer_facebook}, {customer_occupation}, {customer_salary}, {customer_workplace}, {customer_address_work}, {customer_references}
   - ข้อมูลสินค้า: {product_name}, {brand}, {model}, {imei}, {serial_number}, {product_color}, {product_storage}, {product_category}
   - ข้อมูลการเงิน: {selling_price}, {down_payment}, {monthly_payment}, {total_months}, {total_months_text}, {interest_rate}, {interest_total}, {financed_amount}, {financed_amount_text}
   - ข้อมูลงวดชำระ: {first_payment_due}, {first_payment_day}, {first_payment_month}, {first_payment_year}, {last_payment_due}, {payment_schedule_table}
   - ข้อมูลสาขา: {branch_name}, {branch_address}, {branch_phone}
   - ข้อมูลพนักงาน: {salesperson_name}
   - ลายเซ็น: {customer_signature}, {staff_signature}
   - อื่นๆ: {date}

2. จัดหน้าให้เหมาะกับกระดาษ A4 (max-width: 800px, margin: 0 auto)
3. ใช้ font-family: 'Sarabun', 'Noto Sans Thai', sans-serif
4. ใช้ inline CSS เท่านั้น (ไม่ใช้ <style> tag)
5. ห้ามใส่ <script>, <iframe>, หรือ event handler ใดๆ
6. ตอบเป็น HTML เท่านั้น ห้ามมี markdown code block หรือข้อความอื่น
7. ถ้าเอกสารไม่ใช่สัญญาหรือเอกสารทางธุรกิจ ให้สร้างเทมเพลตสัญญาผ่อนชำระทั่วไป โดยอ้างอิงจากรูปแบบที่เห็น`;

  async generateTemplateHtml(fileBase64: string): Promise<{ contentHtml: string; placeholders: string[] }> {
    const client = await this.client.ensureAnthropicReady();
    const { mediaType, base64Data, isDocument } = validateFileBase64(fileBase64);

    try {
      const fileContent = isDocument
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: mediaType as 'application/pdf', data: base64Data } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64Data } };

      const response = await client.messages.create({
        model: AnthropicOcrClient.OCR_MODEL,
        max_tokens: 8192,
        temperature: 0.2,
        system: OcrExtractorsService.TEMPLATE_GENERATION_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              fileContent,
              {
                type: 'text',
                text: 'อ่านเอกสารนี้แล้วสร้าง HTML template ตามรูปแบบที่เห็น ใช้ placeholders แทนข้อมูลจริง ตอบเป็น HTML เท่านั้น',
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new InternalServerErrorException('No text response from Claude');
      }

      // Extract HTML from response (strip markdown code blocks if present)
      let html = textContent.text.trim();
      const htmlMatch = html.match(/```(?:html)?\s*([\s\S]*?)```/);
      if (htmlMatch) {
        html = htmlMatch[1].trim();
      }

      // Extract placeholders used
      const placeholders = [...new Set((html.match(/\{[a-z_]+\}/g) || []))];

      return { contentHtml: html, placeholders };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const errMsg = (error as Error).message || '';
      this.logger.error('Template generation from file failed', errMsg);

      if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT') || errMsg.includes('abort')) {
        throw new InternalServerErrorException('AI ใช้เวลานานเกินไป — ลองใช้ไฟล์ที่มีขนาดเล็กลง หรือเป็นรูปภาพแทน PDF');
      }
      if (errMsg.includes('401') || errMsg.includes('authentication')) {
        throw new InternalServerErrorException('API Key ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
      }
      if (errMsg.includes('429') || errMsg.includes('rate')) {
        throw new InternalServerErrorException('AI ถูกจำกัดการใช้งานชั่วคราว กรุณารอสักครู่แล้วลองใหม่');
      }
      throw new InternalServerErrorException('ไม่สามารถสร้างเทมเพลตจากไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ─── 1. Extract ID Card ─────────────────────────────────

  async extractIdCard(imageBase64: string): Promise<OcrIdCardResult> {
    await this.client.ensureAnthropicReady();
    const { mediaType, base64Data } = validateImageBase64(imageBase64);

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
      const result = await this.client.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

      const rawNationalId = result.nationalId
        ? String(result.nationalId).replace(/[\s-]/g, '')
        : null;

      const nationalIdValid = rawNationalId ? validateNationalId(rawNationalId) : false;

      const birthDate =
        result.birthDate && isValidDate(String(result.birthDate))
          ? String(result.birthDate)
          : null;
      const issueDate =
        result.issueDate && isValidDate(String(result.issueDate))
          ? String(result.issueDate)
          : null;
      const expiryDate =
        result.expiryDate && isValidDate(String(result.expiryDate))
          ? String(result.expiryDate)
          : null;

      const addressStructured = buildAddressStructured(result.addressStructured, this.logger);

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
    await this.client.ensureAnthropicReady();
    const { mediaType, base64Data } = validateImageBase64(imageBase64);

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
      const result = await this.client.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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
      const transactionDate = result.transactionDate && isValidDate(String(result.transactionDate))
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
    await this.client.ensureAnthropicReady();
    const { mediaType, base64Data } = validateImageBase64(imageBase64);

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
      const result = await this.client.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

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
      const lastTransactionDate = result.lastTransactionDate && isValidDate(String(result.lastTransactionDate))
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
    await this.client.ensureAnthropicReady();
    const { mediaType, base64Data } = validateImageBase64(imageBase64);

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
      const result = await this.client.callClaudeOcrWithRetry(mediaType, base64Data, basePrompt, retryPrompt);

      const rawNationalId = result.nationalId
        ? String(result.nationalId).replace(/[\s-]/g, '')
        : null;
      const nationalIdValid = rawNationalId ? validateNationalId(rawNationalId) : false;

      const birthDate = result.birthDate && isValidDate(String(result.birthDate))
        ? String(result.birthDate) : null;
      const issueDate = result.issueDate && isValidDate(String(result.issueDate))
        ? String(result.issueDate) : null;
      const expiryDate = result.expiryDate && isValidDate(String(result.expiryDate))
        ? String(result.expiryDate) : null;

      const addressStructured = buildAddressStructured(result.addressStructured, this.logger);

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

  // ─── 5. Salary Slip OCR ────────────────────────────────

  private static readonly SALARY_SLIP_PROMPT =
    'วิเคราะห์สลิปเงินเดือน/หลักฐานรายได้จากรูปนี้ ดึงข้อมูลต่อไปนี้:\n' +
    '- netSalary: เงินเดือนสุทธิ (ตัวเลข, null ถ้าไม่พบ)\n' +
    '- employerName: ชื่อบริษัท/นายจ้าง (string, null ถ้าไม่พบ)\n' +
    '- slipDate: วันที่ในสลิป (YYYY-MM-DD, null ถ้าไม่พบ)\n' +
    '- payDay: วันที่เงินเดือนออก (ตัวเลข 1-31, null ถ้าไม่ทราบ)\n' +
    '- bankName: ธนาคารที่รับเงิน (string, null ถ้าไม่พบ)\n' +
    '- confidence: ความมั่นใจในการอ่าน (0.0-1.0)\n\n' +
    'ตอบเป็น JSON เท่านั้น ห้ามมี markdown code block';

  private static readonly SALARY_SLIP_RETRY_PROMPT =
    'ดูรูปอีกครั้งอย่างละเอียด โดยเฉพาะตัวเลขเงินเดือนสุทธิ ชื่อบริษัท และวันที่\n' +
    'ถ้าเป็นสลิปธนาคาร ให้ดูยอดเงินเข้าที่เป็นเงินเดือน\n' +
    'ตอบเป็น JSON: { netSalary, employerName, slipDate, payDay, bankName, confidence }';

  async analyzeSalarySlip(imageBase64: string): Promise<OcrSalarySlipResult> {
    await this.client.ensureAnthropicReady();
    const { mediaType, base64Data } = validateImageBase64(imageBase64);

    try {
      const result = await this.client.callClaudeOcrWithRetry(
        mediaType,
        base64Data,
        OcrExtractorsService.SALARY_SLIP_PROMPT,
        OcrExtractorsService.SALARY_SLIP_RETRY_PROMPT,
      );

      const netSalary = result.netSalary != null ? Number(result.netSalary) : null;
      const payDay = result.payDay != null ? Math.max(1, Math.min(31, Math.round(Number(result.payDay)))) : null;
      const slipDate = typeof result.slipDate === 'string' && isValidDate(result.slipDate) ? result.slipDate : null;

      return {
        netSalary: netSalary != null && !isNaN(netSalary) ? netSalary : null,
        employerName: (result.employerName as string) || null,
        slipDate,
        payDay: payDay != null && !isNaN(payDay) ? payDay : null,
        bankName: (result.bankName as string) || null,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        this.logger.error('Failed to parse salary slip OCR response as JSON');
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจากสลิปเงินเดือนได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error('OCR salary slip extraction failed');
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ─── 6. Bank Statement OCR ─────────────────────────────

  private static readonly BANK_STATEMENT_PROMPT =
    'วิเคราะห์ Statement ธนาคารจากรูปนี้ ดึงข้อมูลต่อไปนี้:\n' +
    '- accountName: ชื่อบัญชี (string, null ถ้าไม่พบ)\n' +
    '- bankName: ชื่อธนาคาร (string, null ถ้าไม่พบ)\n' +
    '- totalIncome: ยอดเงินเข้ารวม (ตัวเลข, null ถ้าไม่พบ)\n' +
    '- totalExpense: ยอดเงินออกรวม (ตัวเลข, null ถ้าไม่พบ)\n' +
    '- balance: ยอดคงเหลือ (ตัวเลข, null ถ้าไม่พบ)\n' +
    '- transactionCount: จำนวนรายการทั้งหมด (ตัวเลข, null ถ้าไม่ทราบ)\n' +
    '- dateRange: ช่วงวันที่ของ statement เช่น "01/01/2025 - 31/01/2025" (string, null ถ้าไม่พบ)\n' +
    '- confidence: ความมั่นใจในการอ่าน (0.0-1.0)\n\n' +
    'ตอบเป็น JSON เท่านั้น ห้ามมี markdown code block';

  private static readonly BANK_STATEMENT_RETRY_PROMPT =
    'ดูรูปอีกครั้งอย่างละเอียด โดยเฉพาะยอดเงินเข้า เงินออก ยอดคงเหลือ และช่วงวันที่\n' +
    'ตอบเป็น JSON: { accountName, bankName, totalIncome, totalExpense, balance, transactionCount, dateRange, confidence }';

  async analyzeBankStatement(filesBase64: string[]): Promise<OcrBankStatementResult> {
    await this.client.ensureAnthropicReady();

    if (!Array.isArray(filesBase64) || filesBase64.length === 0) {
      throw new BadRequestException('กรุณาส่งไฟล์อย่างน้อย 1 ไฟล์');
    }

    const validatedFiles = filesBase64.map((b64) => validateFileBase64(b64));

    try {
      const result = await this.client.callClaudeOcrMultiFileWithRetry(
        validatedFiles,
        OcrExtractorsService.BANK_STATEMENT_PROMPT,
        OcrExtractorsService.BANK_STATEMENT_RETRY_PROMPT,
      );

      const totalIncome = result.totalIncome != null ? Number(result.totalIncome) : null;
      const totalExpense = result.totalExpense != null ? Number(result.totalExpense) : null;
      const balance = result.balance != null ? Number(result.balance) : null;
      const transactionCount = result.transactionCount != null ? Math.round(Number(result.transactionCount)) : null;

      return {
        accountName: (result.accountName as string) || null,
        bankName: (result.bankName as string) || null,
        totalIncome: totalIncome != null && !isNaN(totalIncome) ? totalIncome : null,
        totalExpense: totalExpense != null && !isNaN(totalExpense) ? totalExpense : null,
        balance: balance != null && !isNaN(balance) ? balance : null,
        transactionCount: transactionCount != null && !isNaN(transactionCount) ? transactionCount : null,
        dateRange: (result.dateRange as string) || null,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const err = error as Error & { status?: number };
      if (error instanceof SyntaxError) {
        this.logger.error(
          `Failed to parse bank statement OCR response as JSON: ${err.message}`,
          err.stack,
        );
        throw new BadRequestException('ไม่สามารถอ่านข้อมูลจาก Statement ธนาคารได้ กรุณาลองใช้รูปที่ชัดเจนกว่านี้');
      }
      this.logger.error(
        `OCR bank statement extraction failed (status=${err.status ?? 'n/a'}): ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('ระบบ OCR ขัดข้อง กรุณาลองใหม่อีกครั้ง');
    }
  }
}
