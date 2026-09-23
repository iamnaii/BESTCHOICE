import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

const parseJson = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? JSON.parse(value) : value;

export class CreateCaseDto {
  @IsString()
  @MinLength(4)
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

  @IsIn(['REPAIR'])
  outcome!: 'REPAIR'; // PR 1 รับเฉพาะซ่อม (PR 2 เพิ่ม enum อื่น)

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

  @IsUUID()
  branchId!: string;
}
