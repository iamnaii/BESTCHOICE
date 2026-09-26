import { BadRequestException } from '@nestjs/common';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// C6 (final-fix brief) — `accessories` มาเป็น JSON string เสมอจาก multipart/form-data;
// ถ้า client ส่งสตริงที่ parse ไม่ได้ JSON.parse เดิม throw SyntaxError ดิบซึ่ง Nest
// ไม่รู้จักเป็น HttpException ⇒ 500 ดิบ. ห่อด้วย try/catch แล้วโยน BadRequestException
// (400) ที่ ValidationPipe/global filter รู้จักแทน
const parseJson = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException('รูปแบบรายการอุปกรณ์ไม่ถูกต้อง');
  }
};

/** เพดานความยาว IMEI / เลขเครื่อง — ใช้ร่วมกับ LookupDto และช่องกรอกหน้าเว็บ (maxLength) */
export const IMEI_MAX = 32;

export class CreateCaseDto {
  @IsString()
  @MinLength(4)
  // พิมพ์ลงใบรับฝากในคอลัมน์ห้ามตัดบรรทัด — 32 พอสำหรับ IMEI สองซิม (15+1+15)
  @MaxLength(IMEI_MAX, { message: `IMEI ยาวเกิน ${IMEI_MAX} ตัวอักษร` })
  imei!: string; // ตัวที่สแกน (ค้นซ้ำฝั่ง server เพื่อไม่เชื่อ client)

  @IsOptional()
  @IsUUID()
  customerId?: string; // บังคับเมื่อ walk-in / ไม่พบ IMEI

  @IsOptional()
  @IsString()
  deviceBrand?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(IMEI_MAX, { message: `เลขเครื่องยาวเกิน ${IMEI_MAX} ตัวอักษร` })
  deviceSerial?: string;

  @IsString()
  @MinLength(5, { message: 'อาการต้องระบุอย่างน้อย 5 ตัวอักษร' })
  symptom!: string;

  // R4: ValidationPipe ใช้ whitelist:true — ต้องมี @IsObject() ด้วย ไม่งั้นถูกริบทิ้งก่อนถึง service
  @IsObject()
  @Transform(parseJson)
  accessories!: { box?: boolean; charger?: boolean; case?: boolean; other?: string };

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unlockConfirmed!: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsIn(['REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE'], { message: 'ทางออกไม่ถูกต้อง' })
  outcome!: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE'; // PR 2: เพิ่มสองทางออกเปลี่ยนเครื่อง

  @IsOptional()
  @IsIn(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'])
  payer?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsUUID()
  repairSupplierId?: string;

  // ===== ทางออกเปลี่ยนเครื่อง (PR 2) — บังคับตามทางออกใน service ไม่ใช่ที่ DTO =====

  @IsOptional()
  @IsUUID()
  replacementProductId?: string; // SAME_MODEL_EXCHANGE / PRICED_EXCHANGE — เครื่องทดแทนจากสต๊อก

  @IsOptional()
  @IsNumberString({}, { message: 'ราคารับซื้อต้องเป็นตัวเลข' })
  buybackPrice?: string; // PRICED_EXCHANGE

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A-D' })
  deviceCondition?: 'A' | 'B' | 'C' | 'D'; // PRICED_EXCHANGE

  @IsOptional()
  @Type(() => Number) // multipart/form-data ส่งเป็นสตริงเสมอ
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดอย่างน้อย 1' })
  @Max(48, { message: 'จำนวนงวดไม่เกิน 48' })
  newTotalMonths?: number; // PRICED_EXCHANGE

  @IsOptional()
  @IsNumberString({}, { message: 'อัตราดอกเบี้ยต้องเป็นตัวเลข' })
  newInterestRate?: string; // PRICED_EXCHANGE

  @IsOptional()
  @IsString()
  conditionNote?: string; // PRICED_EXCHANGE — ส่งต่อให้ ContractExchangeService.submit

  // ไม่บังคับรูปแบบ UUID — seed/E2E ใช้รหัสสาขาแบบ literal (`branch-001`) แบบเดียวกับ
  // contract.dto.ts; service ตรวจว่าสาขามีจริงหลังเช็ค scope (R16) แทน
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุสาขา' })
  branchId!: string;
}
