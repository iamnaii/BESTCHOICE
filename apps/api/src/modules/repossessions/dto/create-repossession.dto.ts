import { IsString, IsNumber, IsOptional, IsDateString, IsBoolean, IsIn, Min, Max } from 'class-validator';
import { KBANK_ACCOUNT_CODE } from '../../../constants/cash-account.constants';

export class CreateRepossessionDto {
  @IsString({ message: 'กรุณาระบุสัญญา' })
  contractId: string;

  @IsDateString({}, { message: 'กรุณาระบุวันที่ยึดคืน' })
  repossessedDate: string;

  /**
   * วันที่รับเงิน/ลงบัญชี (mirror EarlyPayoffDto.paymentDate) — drives the JP5
   * JE entryDate + period-lock guard. Omitted → now. Backdate allowed while
   * the FINANCE period is open; future dates rejected (BKK calendar day).
   */
  @IsDateString({}, { message: 'วันที่รับเงินไม่ถูกต้อง' })
  @IsOptional()
  paymentDate?: string;

  @IsString({ message: 'กรุณาระบุเกรดสภาพ' })
  conditionGrade: string; // A, B, C, D

  @IsNumber({}, { message: 'กรุณาระบุราคาประเมิน' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice: number;

  @IsNumber({}, { message: 'กรุณาระบุค่าซ่อม' })
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  @IsOptional()
  repairCost?: number;

  @IsNumber({}, { message: 'กรุณาระบุราคาขายต่อ' })
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  @IsOptional()
  resellPrice?: number;

  @IsString({ message: 'กรุณาระบุหมายเหตุเป็นข้อความ' })
  @IsOptional()
  notes?: string;

  // ─── ราคากลาง + คำนวณกำไร/ขาดทุน (FINANCE perspective) ───
  @IsNumber({}, { message: 'ราคากลางต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคากลางต้องไม่ติดลบ' })
  @IsOptional()
  marketValue?: number;

  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @Min(0, { message: 'ส่วนลดต้องไม่ติดลบ' })
  @Max(100, { message: 'ส่วนลดต้องไม่เกิน 100%' })
  @IsOptional()
  discountPct?: number;

  @IsBoolean()
  @IsOptional()
  customerRefundEnabled?: boolean;

  // Cash account dimension for the JP5 deposit leg (direct receipt).
  // Owner rule 2026-07-08: ธนาคารกสิกร (11-1201) เท่านั้น — เงินเข้า FINANCE ตรง
  // ได้ทางเดียวคือโอนเข้ากสิกร; กรณีเครื่อง/เงินอยู่ที่หน้าร้านใช้ collectedByShop.
  // Omitted → falls back to 11-1201.
  @IsString()
  @IsOptional()
  @IsIn([KBANK_ACCOUNT_CODE], {
    message: 'บัญชีรับเงินต้องเป็นธนาคารกสิกร (11-1201) เท่านั้น',
  })
  depositAccountCode?: string;

  /**
   * ตั้งลูกหนี้-หน้าร้าน — เมื่อ true เซิร์ฟเวอร์จะแทนที่ depositAccountCode ด้วย
   * 11-2107 (ลูกหนี้-หน้าร้าน) โดยอัตโนมัติ เหมือน early payoff (JP4).
   * เคลียร์ภายหลังผ่าน POST /contracts/:id/shop-collect-settlement.
   * Client ไม่ส่ง 11-2107 โดยตรง — ผ่าน flag นี้เท่านั้น.
   */
  @IsBoolean()
  @IsOptional()
  collectedByShop?: boolean;
}

export class UpdateRepossessionDto {
  @IsNumber()
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  @IsOptional()
  repairCost?: number;

  @IsNumber()
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  @IsOptional()
  resellPrice?: number;

  @IsString()
  @IsOptional()
  @IsIn(['REPOSSESSED', 'UNDER_REPAIR', 'READY_FOR_SALE', 'SOLD'], {
    message: 'สถานะไม่ถูกต้อง',
  })
  status?: string; // REPOSSESSED, UNDER_REPAIR, READY_FOR_SALE, SOLD

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  soldContractId?: string; // Link to resell contract when SOLD
}
