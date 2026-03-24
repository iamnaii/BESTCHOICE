import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateExchangeDto {
  @IsString({ message: 'กรุณาระบุสัญญาเดิม' })
  oldContractId: string;

  @IsString({ message: 'กรุณาระบุสินค้าใหม่' })
  newProductId: string;

  @IsString({ message: 'กรุณาระบุราคา' })
  newPriceId: string;

  @IsNumber({}, { message: 'กรุณาระบุเงินดาวน์' })
  newDownPayment: number;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนงวด' })
  newTotalMonths: number;

  @IsNumber({}, { message: 'กรุณาระบุอัตราดอกเบี้ย' })
  @IsOptional()
  newInterestRate?: number;

  @IsString({ message: 'กรุณาระบุหมายเหตุเป็นข้อความ' })
  @IsOptional()
  notes?: string;
}
