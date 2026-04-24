import { IsIn, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';

export class LogContactDto {
  @IsIn(['NO_ANSWER', 'ANSWERED', 'PROMISED', 'REFUSED', 'WRONG_NUMBER', 'OTHER'], {
    message: 'result ไม่ถูกต้อง',
  })
  result!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  collectionNotes?: string; // อัปเดต collectionNotes บน Contract ด้วย

  @IsOptional()
  @IsDateString({}, { message: 'settlementDate ต้องเป็นวันที่ ISO' })
  settlementDate?: string;

  @IsOptional()
  @IsString()
  settlementNotes?: string;
}
