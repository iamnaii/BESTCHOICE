import { IsString, IsNumber, IsOptional, IsDateString, IsBoolean } from 'class-validator';

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

  // Cash account dimension for JP5 deposit leg.
  // Falls back to user.defaultCashAccountCode then '11-1101' if omitted.
  @IsString()
  @IsOptional()
  depositAccountCode?: string;
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
