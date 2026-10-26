import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** ช่วงเวลาที่ลบ: 30/90 วัน หรือ 0 = ทั้งหมด (ไม่มีเพดานกู้จริง — สเปก §11 ข้อ 5) */
export const TRASH_DAYS_OPTIONS = [0, 30, 90] as const;

export class TrashTypesDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn(TRASH_DAYS_OPTIONS as unknown as number[], { message: 'ช่วงเวลาต้องเป็น 0, 30 หรือ 90 วัน' })
  days: number = 90;
}

export class ListTrashDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'คำค้นยาวเกินไป' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(TRASH_DAYS_OPTIONS as unknown as number[], { message: 'ช่วงเวลาต้องเป็น 0, 30 หรือ 90 วัน' })
  days: number = 90;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'หน้าต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'หน้าต้องตั้งแต่ 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'จำนวนต่อหน้าต้องเป็นจำนวนเต็ม' })
  @Min(1)
  @Max(100, { message: 'จำนวนต่อหน้าไม่เกิน 100' })
  pageSize: number = 50;
}

export class RestoreTrashItemDto {
  @IsString({ message: 'กรุณาระบุประเภท' })
  @MaxLength(64)
  type!: string;

  @IsString({ message: 'กรุณาระบุรหัสรายการ' })
  @MaxLength(64)
  id!: string;
}

export class RestoreTrashDto {
  @IsArray({ message: 'รายการต้องเป็นอาร์เรย์' })
  @ArrayMinSize(1, { message: 'เลือกอย่างน้อย 1 รายการ' })
  @ArrayMaxSize(50, { message: 'กู้ได้ครั้งละไม่เกิน 50 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => RestoreTrashItemDto)
  items!: RestoreTrashItemDto[];
}
