import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { PAYMENT_APPROVAL_PERMISSIONS, PaymentApprovalPermission } from '../services/payment-approval-permissions';

export class PaymentApprovalUserPermissionsDto {
  @IsUUID('all', { message: 'รหัสผู้ใช้ไม่ถูกต้อง' })
  userId!: string;

  @IsArray({ message: 'สิทธิ์ต้องเป็นรายการ' })
  @ArrayMaxSize(PAYMENT_APPROVAL_PERMISSIONS.length, { message: 'จำนวนสิทธิ์ไม่ถูกต้อง' })
  @ArrayUnique({ message: 'สิทธิ์ต้องไม่ซ้ำกัน' })
  @IsIn(PAYMENT_APPROVAL_PERMISSIONS, { each: true, message: 'ประเภทสิทธิ์อนุมัติไม่ถูกต้อง' })
  permissions!: PaymentApprovalPermission[];
}

/** Full replacement. An empty users array revokes all explicit assignments. */
export class UpdatePaymentApprovalSettingsDto {
  @IsArray({ message: 'ผู้ใช้ต้องเป็นรายการ' })
  @ArrayMaxSize(1000, { message: 'กำหนดสิทธิ์ได้ครั้งละไม่เกิน 1,000 คน' })
  @ArrayUnique((user: PaymentApprovalUserPermissionsDto | null) => user?.userId, { message: 'รายชื่อผู้ใช้ต้องไม่ซ้ำกัน' })
  @ValidateNested({ each: true })
  @Type(() => PaymentApprovalUserPermissionsDto)
  users!: PaymentApprovalUserPermissionsDto[];
}
