import { IsOptional, IsString } from 'class-validator';

export class DecideApplicationDto {
  @IsOptional()
  @IsString()
  rejectReason?: string;

  /** Set when transitioning to CONTRACT_SIGNED (link-contract endpoint). */
  @IsOptional()
  @IsString()
  contractId?: string;
}
