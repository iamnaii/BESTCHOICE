import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportCustomerDto {
  @IsString()
  name: string;

  @IsString()
  nationalId: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  addressIdCard?: string;

  @IsString()
  @IsOptional()
  addressCurrent?: string;

  @IsString()
  @IsOptional()
  occupation?: string;

  @IsString()
  @IsOptional()
  workplace?: string;
}

export class ImportContractDto {
  @IsString()
  customerNationalId: string;

  @IsString()
  productName: string;

  @IsString()
  branchName: string;

  @IsString()
  salespersonEmail: string;

  @IsString()
  @IsOptional()
  planType?: string = 'STORE_DIRECT';

  @IsNumber()
  sellingPrice: number;

  @IsNumber()
  downPayment: number;

  @IsNumber()
  interestRate: number;

  @IsNumber()
  totalMonths: number;

  @IsString()
  status: string;

  @IsDateString()
  @IsOptional()
  createdAt?: string;

  @IsArray()
  @IsOptional()
  payments?: ImportPaymentDto[];
}

export class ImportPaymentDto {
  @IsNumber()
  installmentNo: number;

  @IsDateString()
  dueDate: string;

  @IsNumber()
  amountDue: number;

  @IsNumber()
  amountPaid: number;

  @IsString()
  status: string;

  @IsDateString()
  @IsOptional()
  paidDate?: string;
}

export class ImportCustomersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerDto)
  items: ImportCustomerDto[];
}

export class ImportContractsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportContractDto)
  items: ImportContractDto[];
}

export class BulkImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerDto)
  @IsOptional()
  customers?: ImportCustomerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportContractDto)
  @IsOptional()
  contracts?: ImportContractDto[];
}
