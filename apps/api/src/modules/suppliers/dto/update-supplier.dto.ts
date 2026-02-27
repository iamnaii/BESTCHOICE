import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class UpdateSupplierDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  nickname?: string;

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
  paymentMethod?: string;

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

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
