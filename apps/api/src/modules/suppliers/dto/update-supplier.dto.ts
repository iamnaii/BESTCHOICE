import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsEnum,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierType } from '@prisma/client';

export class PaymentMethodUpdateDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  paymentMethod: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccountName?: string;

  @IsString()
  @IsOptional()
  bankAccountNumber?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  creditTermDays?: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateSupplierDto {
  @IsEnum(SupplierType, { message: 'ประเภทผู้ขายไม่ถูกต้อง' })
  @IsOptional()
  type?: SupplierType;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  titleName?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  contactPosition?: string;

  @IsString()
  @IsOptional()
  nickname?: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก' })
  @IsOptional()
  branchCode?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsBoolean()
  @IsOptional()
  hasVat?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodUpdateDto)
  @IsOptional()
  paymentMethods?: PaymentMethodUpdateDto[];
}
