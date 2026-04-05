import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInterCompanyTransactionDto {
  @IsString({ message: 'กรุณาระบุ Sale ID' })
  saleId: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsString({ message: 'กรุณาระบุสาขา' })
  branchId: string;

  @IsString({ message: 'กรุณาระบุ entity ต้นทาง' })
  fromEntity: string;

  @IsString({ message: 'กรุณาระบุ entity ปลายทาง' })
  toEntity: string;

  @IsNumber({}, { message: 'กรุณาระบุยอดเงินต้น' })
  @Type(() => Number)
  @Min(0)
  principal: number;

  @IsNumber({}, { message: 'กรุณาระบุค่าคอมมิชชัน' })
  @Type(() => Number)
  @Min(0)
  commission: number;

  @IsNumber()
  @Type(() => Number)
  commissionPct: number;

  @IsNumber()
  @Type(() => Number)
  vatAmount: number;

  @IsNumber()
  @Type(() => Number)
  vatPct: number;

  @IsNumber()
  @Type(() => Number)
  totalAmount: number;

  @IsNumber()
  @Type(() => Number)
  interestTotal: number;

  @IsNumber()
  @Type(() => Number)
  costPrice: number;

  @IsNumber()
  @Type(() => Number)
  downPayment: number;

  @IsNumber()
  @Type(() => Number)
  sellingPrice: number;

  @IsNumber()
  @Type(() => Number)
  shopProfit: number;

  @IsNumber()
  @Type(() => Number)
  financeProfit: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryInterCompanyDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
