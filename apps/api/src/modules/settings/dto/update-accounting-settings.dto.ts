import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { ACCOUNTING_PERMISSIONS, AccountingPermission } from '../../../utils/accounting-permissions';

export class AccountingUserPermissionsDto {
  @IsUUID('all', { message: 'รหัสผู้ใช้ไม่ถูกต้อง' })
  userId!: string;

  @IsArray({ message: 'สิทธิ์ต้องเป็นรายการ' })
  @ArrayMaxSize(ACCOUNTING_PERMISSIONS.length, { message: 'จำนวนสิทธิ์ไม่ถูกต้อง' })
  @ArrayUnique({ message: 'สิทธิ์ต้องไม่ซ้ำกัน' })
  @IsIn(ACCOUNTING_PERMISSIONS, { each: true, message: 'ประเภทสิทธิ์รายการบัญชีไม่ถูกต้อง' })
  permissions!: AccountingPermission[];
}

/** Full replacement. An empty users array revokes all explicit assignments. */
export class UpdateAccountingSettingsDto {
  @IsArray({ message: 'ผู้ใช้ต้องเป็นรายการ' })
  @ArrayMaxSize(1000, { message: 'กำหนดสิทธิ์ได้ครั้งละไม่เกิน 1,000 คน' })
  @ArrayUnique((user: AccountingUserPermissionsDto | null) => user?.userId, { message: 'รายชื่อผู้ใช้ต้องไม่ซ้ำกัน' })
  @ValidateNested({ each: true })
  @Type(() => AccountingUserPermissionsDto)
  users!: AccountingUserPermissionsDto[];
}
