import { IsString, IsOptional, IsBoolean, Matches, IsNotEmpty } from 'class-validator';

// ─── LIFF Shop OA DTOs ───────────────────────────────

export class LiffContractsQueryDto {
  @IsString({ message: 'lineId ต้องเป็น string' })
  @IsOptional() // Guard จะ inject liffUserId แทน
  lineId?: string;
}

export class LiffRegisterLookupDto {
  @IsString({ message: 'กรุณาระบุเบอร์โทร' })
  @IsNotEmpty({ message: 'กรุณาระบุเบอร์โทร' })
  @Matches(/^0\d{8,9}$/, { message: 'รูปแบบเบอร์โทรไม่ถูกต้อง (เช่น 0812345678)' })
  phone!: string;
}

export class LiffRegisterConfirmDto {
  @IsString({ message: 'กรุณาระบุ customerId' })
  @IsNotEmpty({ message: 'กรุณาระบุ customerId' })
  customerId!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class LiffProfileQueryDto {
  @IsString({ message: 'lineId ต้องเป็น string' })
  @IsOptional()
  lineId?: string;
}

export class LiffHistoryQueryDto {
  @IsString({ message: 'lineId ต้องเป็น string' })
  @IsOptional()
  lineId?: string;
}

export class LiffUnlinkDto {
  // No body needed — lineId from LiffTokenGuard
}

// ─── LIFF Payment DTOs ───────────────────────────────

export class LiffCreatePaymentLinkDto {
  @IsString({ message: 'กรุณาระบุ contractId' })
  @IsNotEmpty({ message: 'กรุณาระบุ contractId' })
  contractId!: string;

  @IsOptional()
  @IsString()
  paymentId?: string;
}

export class LiffEarlyPayoffQueryDto {
  @IsString({ message: 'lineId ต้องเป็น string' })
  @IsOptional()
  lineId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;
}

export class LiffEarlyPayoffDto {
  @IsString({ message: 'กรุณาระบุ contractId' })
  @IsNotEmpty({ message: 'กรุณาระบุ contractId' })
  contractId!: string;
}

// ─── LIFF Consent DTOs ───────────────────────────────

export class LiffConsentDto {
  @IsBoolean({ message: 'กรุณาระบุสถานะการยินยอม' })
  consent!: boolean;
}

// ─── LIFF Notification Preferences ──────────────────

export class LiffNotificationPreferencesDto {
  @IsBoolean({ message: 'กรุณาระบุค่า paymentReminder' })
  paymentReminder!: boolean;

  @IsBoolean({ message: 'กรุณาระบุค่า overdueNotice' })
  overdueNotice!: boolean;

  @IsBoolean({ message: 'กรุณาระบุค่า receiptNotification' })
  receiptNotification!: boolean;
}
