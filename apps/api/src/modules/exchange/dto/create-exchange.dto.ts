import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateExchangeDto {
  @IsString()
  oldContractId: string;

  @IsString()
  newProductId: string;

  @IsString()
  newPriceId: string;

  @IsNumber()
  newDownPayment: number;

  @IsNumber()
  newTotalMonths: number;

  @IsNumber()
  @IsOptional()
  newInterestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
