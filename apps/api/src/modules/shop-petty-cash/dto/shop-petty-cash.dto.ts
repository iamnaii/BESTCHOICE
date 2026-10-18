import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SHOP_PETTY_CASH_MAX_LIMIT } from '../shop-petty-cash.constants';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

const BANK_CODES = [ShopAccountResolver.SHOP_PAYING_BANK, ShopAccountResolver.SHOP_RECEIVING_BANK];

/**
 * เติม/คืนเงินสดย่อย (ข้อ 20.2 · 2026-10-18) — ส่งเป็น multipart (รูปหลักฐานไม่บังคับในช่อง `evidence`)
 * ค่าตัวเลขมาเป็นสตริง: ValidationPipe แปลงให้ (แบบเดียวกับ CreateCashDepositDto ของสมุดเงินหน้าร้าน)
 */
export class RecordShopPettyCashDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  @Max(SHOP_PETTY_CASH_MAX_LIMIT, { message: 'จำนวนเงินสูงเกินไป' })
  amount!: number;

  /** ธนาคารหน้าร้าน — ไม่ส่ง = ค่าเริ่มต้นตามชนิด (เติม: จ่ายออก S11-1202 · คืน: รับเข้า S11-1201) */
  @IsOptional()
  @IsString()
  @IsIn(BANK_CODES, { message: 'เลือกได้เฉพาะธนาคารหน้าร้าน (จ่ายออก / รับเข้า)' })
  bankAccountCode?: string;

  /** วันที่ถอน/ฝาก YYYY-MM-DD (ปฏิทินไทย) — ≤ วันนี้ ย้อนหลังไม่เกิน 365 วัน (service ตรวจ) */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ไม่ถูกต้อง (YYYY-MM-DD)' })
  movedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;

  /** uuid ต่อการเปิดกล่อง — ส่งซ้ำได้รายการเดิม */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

/** ตั้งวงเงินเงินสดย่อย (OWNER) — 0 = ปิดการเติมจนกว่าจะตั้งใหม่ */
export class SetShopPettyCashLimitDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'วงเงินต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'วงเงินต้องเป็น 0 ขึ้นไป' })
  @Max(SHOP_PETTY_CASH_MAX_LIMIT, { message: 'วงเงินต้องไม่เกิน 1,000,000 บาท' })
  limit!: number;
}
