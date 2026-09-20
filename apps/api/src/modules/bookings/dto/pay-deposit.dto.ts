import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TenderInputDto } from '../../shop-tenders/dto/tender-input.dto';
import { MAX_TENDERS } from '../../shop-tenders/shop-tender.util';

export const BOOKING_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'QR_EWALLET'] as const;
export type DepositMethod = (typeof BOOKING_PAYMENT_METHODS)[number];

/** Receipt into SHOP. The server resolves and stores the actual branch/method account. */
export class PayDepositDto {
  /** วิธีรับแบบเดิม (วิธีเดียว) — ไม่ต้องส่งเมื่อส่ง `tenders`; ระบบเก็บวิธีของ tender แรกลงคอลัมน์นี้ */
  @ValidateIf((o: PayDepositDto) => !o.tenders?.length)
  @IsIn(BOOKING_PAYMENT_METHODS, { message: 'กรุณาเลือกวิธีรับเงินสด โอนธนาคาร หรือ QR / e-Wallet' })
  depositMethod?: DepositMethod;

  /** ช่องรับเงิน (สเปค 2026-09-20-shop-tenders-daily-cash): จ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TENDERS)
  @ValidateNested({ each: true })
  @Type(() => TenderInputDto)
  tenders?: TenderInputDto[];

  /** Optional compatibility assertion; a mismatched account is rejected, never stored. */
  @IsOptional()
  @IsString()
  depositAccountCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
