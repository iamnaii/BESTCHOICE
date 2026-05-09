import {
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
  Min,
  MinLength,
} from 'class-validator';

const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export class DisposeAssetDto {
  @IsIn(['SALE', 'WRITE_OFF'], { message: 'วิธีจำหน่ายไม่ถูกต้อง' })
  disposalType: 'SALE' | 'WRITE_OFF';

  @IsDateString({}, { message: 'วันที่จำหน่ายไม่ถูกต้อง' })
  disposalDate: string;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsNumber({}, { message: 'ราคาขายต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'ราคาขายต้องมากกว่า 0' })
  proceeds?: number;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;

  /**
   * ออกใบกำกับภาษีให้ผู้ซื้อ (ตาม ม.77/1 + ม.82 — การขายสินทรัพย์ถาวรอยู่ในข่าย VAT 7%)
   * ถ้า true: ระบบจะเพิ่ม Cr 21-2101 (VAT 7% × proceeds) อัตโนมัติ + ผู้ซื้อจ่าย proceeds × 1.07
   * ถ้า false: รับเฉพาะ proceeds (ไม่ออกใบกำกับ — ใช้เมื่อขายให้บุคคลทั่วไปที่ไม่ต้องการใบกำกับ)
   */
  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsOptional()
  @IsBoolean({ message: 'issueTaxInvoice ต้องเป็น boolean' })
  issueTaxInvoice?: boolean;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผล' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
