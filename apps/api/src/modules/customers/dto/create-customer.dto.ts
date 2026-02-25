import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  nationalId: string;

  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  phoneSecondary?: string;

  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsString()
  addressIdCard?: string;

  @IsOptional()
  @IsString()
  addressCurrent?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsString()
  workplace?: string;

  @IsOptional()
  @IsArray()
  documents?: string[];
}
