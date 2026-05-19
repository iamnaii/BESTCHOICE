import { IsUUID, IsOptional, IsString, IsDateString } from 'class-validator';

export class ReplaceDto {
  @IsUUID()
  replacementContractId!: string;

  @IsOptional()
  @IsDateString()
  replacedAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
