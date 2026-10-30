import { IsString, IsOptional, IsBoolean, IsNotEmpty } from 'class-validator';

// ─── LIFF Shop OA DTOs ───────────────────────────────

export class LiffContractsQueryDto {
  @IsString({ message: 'lineId ต้องเป็น string' })
  @IsOptional() // Guard จะ inject liffUserId แทน
  lineId?: string;
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
