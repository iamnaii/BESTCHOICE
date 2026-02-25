import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateCallLogDto {
  @IsString()
  contractId: string;

  @IsDateString()
  calledAt: string;

  @IsString()
  result: string; // ANSWERED, NO_ANSWER, PROMISED, REFUSED

  @IsString()
  @IsOptional()
  notes?: string;
}
