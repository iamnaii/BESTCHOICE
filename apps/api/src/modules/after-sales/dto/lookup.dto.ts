import { IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';

export class LookupDto {
  @ValidateIf((o) => !o.customerId)
  @IsString()
  @MinLength(4, { message: 'IMEI อย่างน้อย 4 ตัว' })
  imei?: string;

  @ValidateIf((o) => !o.imei)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string; // ใช้เมื่อค้นด้วยลูกค้าแล้วเลือกเครื่อง
}
