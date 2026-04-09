import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class LockDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมายเลข IMEI' })
  @MaxLength(20, { message: 'หมายเลข IMEI ต้องไม่เกิน 20 ตัวอักษร' })
  imei: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลในการล็อค' })
  @MaxLength(255, { message: 'เหตุผลต้องไม่เกิน 255 ตัวอักษร' })
  reason: string;
}

export class UnlockDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมายเลข IMEI' })
  @MaxLength(20, { message: 'หมายเลข IMEI ต้องไม่เกิน 20 ตัวอักษร' })
  imei: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  note?: string;
}

export class DeviceStatusDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมายเลข IMEI' })
  @MaxLength(20, { message: 'หมายเลข IMEI ต้องไม่เกิน 20 ตัวอักษร' })
  imei: string;
}
