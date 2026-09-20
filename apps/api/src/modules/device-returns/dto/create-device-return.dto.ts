import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REPOSSESSION_RETURN_REASONS,
  RepossessionReturnReason,
} from '../../repossessions/dto/create-repossession.dto';

export const CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const;
export type ConditionGradeCode = (typeof CONDITION_GRADES)[number];

/** POST /device-returns — spec 2026-09-20 §5.1 (ประเภทคืน/ยึด ระบบ derive จากสถานะสัญญา ไม่รับจาก client) */
export class CreateDeviceReturnDto {
  @IsUUID(undefined, { message: 'กรุณาระบุสัญญา' })
  contractId: string;

  /** วันรับเครื่องจริง (ไม่เป็นอนาคตตามปฏิทินไทย — service ตรวจ) */
  @IsDateString({}, { message: 'กรุณาระบุวันที่รับเครื่อง' })
  deviceReceivedAt: string;

  @IsIn(CONDITION_GRADES, { message: 'เกรดสภาพต้องเป็น A, B, C, D' })
  conditionGrade: ConditionGradeCode;

  /** ราคาประเมิน = ราคาที่ SHOP รับเครื่องไป (ราคาเดียว 2026-09-05) — service บังคับ > 0 */
  @IsNumber({}, { message: 'กรุณาระบุราคาประเมิน' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'ค่าซ่อมต้องเป็นตัวเลข' })
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  repairCost?: number;

  /**
   * key ของ REPOSSESSION_RETURN_REASONS — VOLUNTARY ต้องส่ง (UNAFFORDABLE / NO_LONGER_NEEDED / OTHER);
   * สัญญา TERMINATED ไม่ส่ง = ระบบตั้ง AFTER_TERMINATION ให้ (spec §5.1 ข้อ 2)
   */
  @IsOptional()
  @IsIn(Object.keys(REPOSSESSION_RETURN_REASONS), {
    message: 'กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง',
  })
  returnReason?: RepossessionReturnReason;

  /** บังคับเมื่อ returnReason = OTHER หรือราคาต่างจากตารางเกิน 15% (service ตรวจ) */
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(1000, { message: 'หมายเหตุยาวได้ไม่เกิน 1000 ตัวอักษร' })
  notes?: string;

  /** OWNER เท่านั้น (ไม่มีสาขาสังกัด) — BM/SALES ใช้ user.branchId เสมอ ค่านี้ถูกละเลย */
  @IsOptional()
  @IsUUID(undefined, { message: 'สาขาที่รับเครื่องไม่ถูกต้อง' })
  receivingBranchId?: string;
}
