import { IsString, IsOptional } from 'class-validator';

export class TransferProductDto {
  @IsString()
  toBranchId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
