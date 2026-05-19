import { IsString, IsOptional, IsNumber, Min, Max, IsDateString } from 'class-validator';

export class CreateCommissionDto {
  @IsString()
  externalFinanceCompanyId!: string;

  @IsOptional()
  @IsString()
  saleReferenceId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsNumber()
  @Min(0)
  financedAmount!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate!: number;
}

export class MarkReceivedDto {
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  bankSlipUrl?: string;
}
