import { IsString, IsOptional, IsDateString, IsNumberString } from 'class-validator';

export class CreateFinanceReceivableDto {
  @IsString({ message: 'กรุณาระบุบริษัทไฟแนนซ์' })
  financeCompanyId: string;

  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString({ message: 'กรุณาระบุสาขา' })
  branchId: string;

  @IsNumberString({}, { message: 'กรุณาระบุยอดที่คาดว่าจะได้รับ' })
  expectedAmount: string;

  @IsDateString({}, { message: 'รูปแบบวันครบกำหนดไม่ถูกต้อง' })
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateFinanceReceivableDto {
  @IsNumberString({}, { message: 'กรุณาระบุยอดที่คาดว่าจะได้รับ' })
  @IsOptional()
  expectedAmount?: string;

  @IsDateString({}, { message: 'รูปแบบวันครบกำหนดไม่ถูกต้อง' })
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
