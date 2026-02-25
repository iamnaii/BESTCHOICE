import { IsString, IsNumber, IsOptional, IsDateString, IsEnum } from 'class-validator';

export class CreateRepossessionDto {
  @IsString()
  contractId: string;

  @IsDateString()
  repossessedDate: string;

  @IsString()
  conditionGrade: string; // A, B, C, D

  @IsNumber()
  appraisalPrice: number;

  @IsNumber()
  @IsOptional()
  repairCost?: number;

  @IsNumber()
  @IsOptional()
  resellPrice?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateRepossessionDto {
  @IsNumber()
  @IsOptional()
  repairCost?: number;

  @IsNumber()
  @IsOptional()
  resellPrice?: number;

  @IsString()
  @IsOptional()
  status?: string; // REPOSSESSED, UNDER_REPAIR, READY_FOR_SALE, SOLD

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  soldContractId?: string; // Link to resell contract when SOLD
}
