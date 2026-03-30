import {
  IsString,
  IsOptional,
  IsDateString,
  IsNumberString,
  IsEnum,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ExpenseCategory, PaymentMethod } from '@prisma/client';

export class CreateExpenseDto {
  @IsString({ message: 'กรุณาระบุสาขา' })
  branchId: string;

  @IsEnum(ExpenseCategory, { message: 'หมวดค่าใช้จ่ายไม่ถูกต้อง' })
  category: ExpenseCategory;

  @IsString()
  @IsOptional()
  customCategory?: string;

  @IsString({ message: 'กรุณาระบุรายละเอียด' })
  description: string;

  @IsNumberString({}, { message: 'กรุณาระบุจำนวนเงิน' })
  amount: string;

  @IsDateString({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  expenseDate: string;

  @IsEnum(PaymentMethod, { message: 'วิธีการชำระเงินไม่ถูกต้อง' })
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidenceUrls?: string[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;
}
