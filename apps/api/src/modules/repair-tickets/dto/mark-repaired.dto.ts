import { IsNumber, Min, IsEnum, IsOptional, IsDateString } from 'class-validator';

enum RepairPayerInput {
  SHOP = 'SHOP',
  CUSTOMER = 'CUSTOMER',
  SUPPLIER_CLAIM = 'SUPPLIER_CLAIM',
}

export class MarkRepairedDto {
  @IsNumber()
  @Min(0)
  actualCost!: number;

  @IsEnum(RepairPayerInput)
  payer!: RepairPayerInput;

  @IsOptional()
  @IsDateString()
  repairedAt?: string;
}
