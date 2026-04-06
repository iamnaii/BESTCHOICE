import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

export class RecordSettlementDto {
  @IsDateString({}, { message: 'กรุณาระบุวันที่นัดชำระให้ถูกต้อง' })
  settlementDate: string;

  @IsString({ message: 'กรุณาระบุรายละเอียดการนัดชำระ' })
  @MaxLength(2000, { message: 'รายละเอียดต้องไม่เกิน 2000 ตัวอักษร' })
  settlementNotes: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'หมายเหตุต้องไม่เกิน 2000 ตัวอักษร' })
  notes?: string;
}
