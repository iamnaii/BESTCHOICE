import { IsString, IsOptional, MinLength, IsUUID, IsNumber, Min } from 'class-validator';

export class UpdateRepairTicketDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  defectDescription?: string;

  @IsOptional()
  @IsUUID()
  repairSupplierId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
