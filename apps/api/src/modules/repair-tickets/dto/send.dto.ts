import { IsUUID, IsOptional, IsString, IsNumber, Min, IsDateString } from 'class-validator';

export class SendDto {
  @IsUUID('4', { message: 'ต้องระบุที่ซ่อม' })
  repairSupplierId!: string;

  @IsOptional()
  @IsDateString()
  sentToRepairAt?: string;

  @IsOptional()
  @IsString()
  externalClaimNo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number;
}
