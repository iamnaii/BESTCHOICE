import { IsOptional, IsUUID, IsString, MinLength } from 'class-validator';

export class WarrantyLookupDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  imei?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  serial?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  contractNumber?: string;
}
