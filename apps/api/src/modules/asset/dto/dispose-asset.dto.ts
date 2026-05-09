import {
  IsString,
  IsNumber,
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

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผล' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
