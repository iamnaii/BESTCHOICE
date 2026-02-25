import { IsString, IsOptional, IsEnum } from 'class-validator';

export class UpdateContractDto {
  @IsOptional()
  @IsEnum(['DRAFT', 'ACTIVE', 'OVERDUE', 'DEFAULT', 'EARLY_PAYOFF', 'COMPLETED', 'EXCHANGED', 'CLOSED_BAD_DEBT'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
