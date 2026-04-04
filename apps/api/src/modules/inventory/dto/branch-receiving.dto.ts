import { IsString, IsOptional, IsArray, ValidateNested, IsIn, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class BranchReceivingItemDto {
  @IsString()
  productId: string;

  @IsString()
  @IsOptional()
  imeiSerial?: string; // สแกนยืนยัน IMEI

  @IsIn(['PASS', 'REJECT'])
  status: 'PASS' | 'REJECT';

  @IsString()
  @IsOptional()
  conditionNotes?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

  @IsString()
  @IsOptional()
  rejectReason?: string;
}

export class CreateBranchReceivingDto {
  @IsString()
  transferId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BranchReceivingItemDto)
  items: BranchReceivingItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}
