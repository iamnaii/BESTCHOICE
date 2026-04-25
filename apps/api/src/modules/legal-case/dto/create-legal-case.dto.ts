import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create LegalCase DTO (P2 Task 7).
 *
 * Required fields are the bare minimum needed to file the case in court
 * intake; lawyer + hearing details can be filled in later via Update.
 */
export class CreateLegalCaseDto {
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุเลขคดี' })
  @MaxLength(100, { message: 'เลขคดียาวเกินไป' })
  caseNumber!: string;

  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อศาล' })
  @MaxLength(200, { message: 'ชื่อศาลยาวเกินไป' })
  court!: string;

  @IsOptional()
  @IsDateString({}, { message: 'วันนัดต้องเป็นรูปแบบวันที่ที่ถูกต้อง' })
  hearingDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อทนายความยาวเกินไป' })
  lawyerName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์ทนายความต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  lawyerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'หมายเหตุยาวเกินไป' })
  notes?: string;
}
