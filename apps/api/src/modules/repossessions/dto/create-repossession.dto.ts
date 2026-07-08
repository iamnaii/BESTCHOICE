import { IsString, IsNumber, IsOptional, IsDateString, IsBoolean, IsIn } from 'class-validator';
import { KBANK_ACCOUNT_CODE } from '../../../constants/cash-account.constants';

export class CreateRepossessionDto {
  @IsString({ message: 'กรุณาระบุสัญญา' })
  contractId: string;

  @IsDateString({}, { message: 'กรุณาระบุวันที่ยึดคืน' })
  repossessedDate: string;

  @IsString({ message: 'กรุณาระบุเกรดสภาพ' })
  conditionGrade: string; // A, B, C, D

  @IsNumber({}, { message: 'กรุณาระบุราคาประเมิน' })
  appraisalPrice: number;

  @IsNumber({}, { message: 'กรุณาระบุค่าซ่อม' })
  @IsOptional()
  repairCost?: number;

  @IsNumber({}, { message: 'กรุณาระบุราคาขายต่อ' })
  @IsOptional()
  resellPrice?: number;

  @IsString({ message: 'กรุณาระบุหมายเหตุเป็นข้อความ' })
  @IsOptional()
  notes?: string;

  // ─── ราคากลาง + คำนวณกำไร/ขาดทุน (FINANCE perspective) ───
  @IsNumber({}, { message: 'ราคากลางต้องเป็นตัวเลข' })
  @IsOptional()
  marketValue?: number;

  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
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
  @IsOptional()
  repairCost?: number;

  @IsNumber()
  @IsOptional()
  resellPrice?: number;

  @IsString()
  @IsOptional()
  status?: string; // REPOSSESSED, UNDER_REPAIR, READY_FOR_SALE, SOLD

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  soldContractId?: string; // Link to resell contract when SOLD
}
