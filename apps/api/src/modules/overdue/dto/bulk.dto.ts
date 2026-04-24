import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class BulkAssignDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องเลือกอย่างน้อย 1 รายการ' })
  @ArrayMaxSize(100, { message: 'เลือกได้สูงสุด 100 รายการต่อครั้ง' })
  @IsString({ each: true })
  contractIds!: string[];

  @IsString({ message: 'ต้องระบุผู้รับมอบหมาย' })
  assignedToId!: string;
}

export class BulkSendLineDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  contractIds!: string[];

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'ข้อความต้อง ≥ 10 ตัวอักษร' })
  customMessage?: string;
}

export class BulkProposeLockDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  contractIds!: string[];

  @IsString()
  @MinLength(5, { message: 'เหตุผล ≥ 5 ตัวอักษร' })
  reason!: string;
}
