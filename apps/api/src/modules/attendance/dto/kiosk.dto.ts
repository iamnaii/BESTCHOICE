import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** DTO ของเครื่องตอกบัตร (สาธารณะ token-gated) — ข้อความไทย · multipart ส่งทุกฟิลด์เป็นสตริง */
export class RegisterKioskDto {
  @IsString({ message: 'กรุณากรอกรหัสลงทะเบียน' })
  @Length(8, 8, { message: 'รหัสลงทะเบียนต้องมี 8 ตัว' })
  code!: string;

  @IsString({ message: 'กรุณาตั้งชื่อเครื่อง' })
  @Length(1, 60, { message: 'ชื่อเครื่องต้องยาว 1–60 ตัวอักษร' })
  deviceName!: string;
}

export class HeartbeatKioskDto {
  @IsString()
  deviceToken!: string;

  @IsUUID('4', { message: 'requestId ต้องเป็น uuid' })
  requestId!: string;
}

export class PunchKioskDto extends HeartbeatKioskDto {
  @Matches(/^\d{6}$/, { message: 'รหัสตอกบัตรต้องเป็นตัวเลข 6 หลัก' })
  pin!: string;

  @IsIn(['IN', 'OUT'], { message: 'kind ต้องเป็น IN หรือ OUT' })
  kind!: 'IN' | 'OUT';

  @IsOptional()
  @IsNumberString()
  geoLat?: string;

  @IsOptional()
  @IsNumberString()
  geoLng?: string;
}
