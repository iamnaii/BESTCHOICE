import { IsString, IsOptional, IsArray, IsBoolean, IsDateString, IsNumber, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @IsString()
  @Length(13, 13, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  nationalId: string;

  @IsString()
  @IsOptional()
  prefix?: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  nickname?: string;

  @IsBoolean()
  @IsOptional()
  isForeigner?: boolean;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  phone: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  facebookLink?: string;

  @IsString()
  @IsOptional()
  facebookName?: string;

  @IsString()
  @IsOptional()
  facebookFriends?: string;

  @IsString()
  @IsOptional()
  googleMapLink?: string;

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
  occupationDetail?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  salary?: number;

  @IsString()
  @IsOptional()
  workplace?: string;

  @IsString()
  @IsOptional()
  addressWork?: string;

  @IsOptional()
  references?: unknown;

  @IsArray()
  @IsOptional()
  documents?: string[];
}

export class UpdateCustomerDto {
  @IsString()
  @IsOptional()
  prefix?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  nickname?: string;

  @IsBoolean()
  @IsOptional()
  isForeigner?: boolean;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  phoneSecondary?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  lineId?: string;

  @IsString()
  @IsOptional()
  facebookLink?: string;

  @IsString()
  @IsOptional()
  facebookName?: string;

  @IsString()
  @IsOptional()
  facebookFriends?: string;

  @IsString()
  @IsOptional()
  googleMapLink?: string;

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
  occupationDetail?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  salary?: number;

  @IsString()
  @IsOptional()
  workplace?: string;

  @IsString()
  @IsOptional()
  addressWork?: string;

  @IsOptional()
  references?: unknown;

  @IsArray()
  @IsOptional()
  documents?: string[];
}
