import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IMEI_MAX } from './create-case.dto';

export class LookupDto {
  @ValidateIf((o) => !o.customerId)
  @IsString()
  @MinLength(4, { message: 'IMEI อย่างน้อย 4 ตัว' })
  @MaxLength(IMEI_MAX, { message: `IMEI ยาวเกิน ${IMEI_MAX} ตัวอักษร` })
  imei?: string;

  @ValidateIf((o) => !o.imei)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string; // ใช้เมื่อค้นด้วยลูกค้าแล้วเลือกเครื่อง
}
