import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Per-file size cap. A 5MB raw image → ~6.7MB base64 (33% overhead).
// Cap at 8MB base64 per file so owners can upload full-resolution phone
// photos without needing pre-compression, while bounding memory usage.
const MAX_FILE_BASE64_BYTES = 8 * 1024 * 1024;

export class CreateCreditCheckDto {
  @IsString()
  @IsOptional()
  bankName?: string;

  @IsArray()
  @ArrayMaxSize(5, { message: 'อัปโหลดได้สูงสุด 5 ไฟล์' })
  @IsString({ each: true })
  @MaxLength(MAX_FILE_BASE64_BYTES, {
    each: true,
    message: 'ไฟล์มีขนาดใหญ่เกินไป (สูงสุด ~6MB ต่อไฟล์)',
  })
  statementFiles: string[]; // base64 encoded file URLs

  @IsNumber()
  @IsOptional()
  statementMonths?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'หมายเหตุต้องไม่เกิน 2000 ตัวอักษร' })
  reviewNotes?: string;
}

export class OverrideCreditCheckDto {
  @IsString()
  @Matches(/^(APPROVED|REJECTED|MANUAL_REVIEW)$/, {
    message: 'status ต้องเป็น APPROVED, REJECTED หรือ MANUAL_REVIEW',
  })
  status: string;

  // T4-C4: evidence gate. Override ยกเลิกผล AI ต้องมีเหตุผลเชิงบรรยาย ≥ 20
  // ตัวอักษร (ลดพื้นที่ของ "ok"/"approve" rubber-stamping) และแนบ attachmentIds
  // (เอกสารที่อัปโหลดผ่านระบบ) เพื่อให้ตรวจย้อนหลังได้ นโยบายปัจจุบันยังยอม
  // list ว่างได้ (informational) — deprecate เมื่อ business ตกลง mandate
  @IsString({ message: 'ต้องระบุเหตุผลการเปลี่ยนผลตรวจเครดิต' })
  @IsNotEmpty({ message: 'ต้องระบุเหตุผลการเปลี่ยนผลตรวจเครดิต' })
  @MinLength(20, { message: 'เหตุผลต้องมีอย่างน้อย 20 ตัวอักษร' })
  @MaxLength(2000, { message: 'เหตุผลต้องไม่เกิน 2000 ตัวอักษร' })
  overrideReason!: string;

  @IsArray({ message: 'attachmentIds ต้องเป็น array' })
  @ArrayMinSize(0)
  @IsString({ each: true, message: 'attachmentIds ต้องเป็น array ของ string' })
  @IsOptional()
  attachmentIds?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'หมายเหตุต้องไม่เกิน 2000 ตัวอักษร' })
  reviewNotes?: string;
}
