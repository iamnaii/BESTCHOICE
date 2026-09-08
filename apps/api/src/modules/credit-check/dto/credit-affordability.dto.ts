import { Equals, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreditAffordabilityDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999.99)
  verifiedMonthlyIncome!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999.99)
  livingExpenses!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999.99)
  externalMonthlyDebt!: number;

  @IsInt() @Min(1) @Max(31)
  salaryPayDay!: number;

  @IsString() @MinLength(20, { message: 'ระบุที่มารายได้ รายจ่าย หนี้ และวันเงินเดือนอย่างน้อย 20 ตัวอักษร' }) @MaxLength(2000)
  evidenceNotes!: string;
}

export class ApproveCreditAffordabilityDto extends CreditAffordabilityDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999.99)
  approvedMonthlyPayment!: number;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  contextToken!: string;

  @Equals(true, { message: 'กรุณายืนยันตัวเลขและหลักฐานก่อนอนุมัติ' })
  confirmed!: boolean;
}
