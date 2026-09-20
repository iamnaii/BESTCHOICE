import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';

export const REPOSSESSION_RETURN_REASONS = {
  UNAFFORDABLE: 'ลูกค้าไม่สามารถผ่อนต่อได้',
  NO_LONGER_NEEDED: 'ลูกค้าไม่ประสงค์ใช้งานต่อ',
  AFTER_TERMINATION: 'รับเครื่องคืนหลังบอกเลิกสัญญา',
  OTHER: 'อื่น ๆ',
} as const;
export type RepossessionReturnReason = keyof typeof REPOSSESSION_RETURN_REASONS;

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
