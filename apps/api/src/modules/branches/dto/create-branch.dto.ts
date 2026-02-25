import { IsString, IsOptional } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
