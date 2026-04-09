import { IsString, IsOptional, MaxLength } from 'class-validator';

export class LogContactDto {
  @IsString({ message: 'กรุณาระบุผลการติดต่อ' })
  result: string; // NO_ANSWER | ANSWERED | PROMISED_TO_PAY | REFUSED | WRONG_NUMBER | OTHER

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  collectionNotes?: string; // อัปเดต collectionNotes บน Contract ด้วย
}
