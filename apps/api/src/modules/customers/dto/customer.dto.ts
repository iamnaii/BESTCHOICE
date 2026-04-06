import { IsString, IsOptional, IsArray, IsBoolean, IsDateString, IsNumber, Length, ValidateNested } from 'class-validator';
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
  addressCurrentType?: string; // บ้านตัวเอง, บ้านญาติ, เช่าอาศัย

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

  @IsArray()
  @ValidateNested({ each: true })
  @IsOptional()
  references?: Record<string, unknown>[];

  @IsString()
  @IsOptional()
  referredById?: string;

  @IsArray()
  @IsString({ each: true })
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
  addressCurrentType?: string; // บ้านตัวเอง, บ้านญาติ, เช่าอาศัย

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

  @IsArray()
  @ValidateNested({ each: true })
  @IsOptional()
  references?: Record<string, unknown>[];

  @IsString()
  @IsOptional()
  referredById?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documents?: string[];
}
