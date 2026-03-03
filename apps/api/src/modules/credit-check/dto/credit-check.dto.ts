import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class CreateCreditCheckDto {
  @IsString()
  @IsOptional()
  bankName?: string;

  @IsArray()
  @IsString({ each: true })
  statementFiles: string[]; // base64 encoded file URLs

  @IsNumber()
  @IsOptional()
  statementMonths?: number;
}

export class OverrideCreditCheckDto {
  @IsString()
  status: string; // APPROVED, REJECTED, MANUAL_REVIEW

  @IsString()
  @IsOptional()
  reviewNotes?: string;
}
