import { IsString, IsNotEmpty, IsOptional, IsInt, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

// ─── Device lookup ────────────────────────────────────────

export class DeviceStatusDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหมายเลข IMEI' })
  @MaxLength(20, { message: 'หมายเลข IMEI ต้องไม่เกิน 20 ตัวอักษร' })
  imei: string;
}

export class DeviceByIdDto {
  @Type(() => Number)
  @IsInt({ message: 'ID ต้องเป็นตัวเลข' })
  @Min(1)
  id: number;
}

// ─── Lost Mode (lock/unlock for overdue) ──────────────────

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

  /// T6-C6: reason required — prevents "quiet unlock" kickback. Callers
  /// must describe why the phone is being released (paid in full, settlement
  /// agreement, legal dispute, etc.)
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลในการปลดล็อค' })
  @MaxLength(500, { message: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' })
  reason!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  note?: string;
}

// ─── Lock screen text ─────────────────────────────────────

export class SetLockScreenTextDto {
  @Type(() => Number)
  @IsInt({ message: 'ID ต้องเป็นตัวเลข' })
  id: number;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุข้อความ' })
  @MaxLength(500, { message: 'ข้อความต้องไม่เกิน 500 ตัวอักษร' })
  message: string;
}

// ─── Add device ───────────────────────────────────────────

export class AddDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ Serial Number' })
  deviceId: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเบอร์โทร' })
  phone: string;
}

// ─── Edit device ──────────────────────────────────────────

export class EditDeviceDto {
  @Type(() => Number)
  @IsInt()
  id: number;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเบอร์โทร' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่ออุปกรณ์' })
  deviceName: string;
}
