import { ArrayNotEmpty, IsArray, IsInt, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ReorderRow {
  @IsString()
  @IsUUID('4', { message: 'รูปแบบ id ไม่ถูกต้อง' })
  id!: string;

  @IsInt({ message: 'sortOrder ต้องเป็นจำนวนเต็ม' })
  sortOrder!: number;
}

export class ReorderReverseReasonsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุรายการอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => ReorderRow)
  rows!: ReorderRow[];
}
