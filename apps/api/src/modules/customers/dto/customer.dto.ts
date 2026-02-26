import { IsString, IsOptional, IsArray, Length } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @Length(13, 13, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  nationalId: string;

  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  addressIdCard?: string;

  @IsString()
  @IsOptional()
  addressCurrent?: string;

  @IsString()
  @IsOptional()
  occupation?: string;

  @IsString()
  @IsOptional()
  workplace?: string;

  @IsArray()
  @IsOptional()
  documents?: string[];
}

export class UpdateCustomerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  addressIdCard?: string;

  @IsString()
  @IsOptional()
  addressCurrent?: string;

  @IsString()
  @IsOptional()
  occupation?: string;

  @IsString()
  @IsOptional()
  workplace?: string;

  @IsArray()
  @IsOptional()
  documents?: string[];
}
