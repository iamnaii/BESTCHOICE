import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { CONDITION_GRADES, ConditionGradeCode } from './create-device-return.dto';

/** GET /device-returns/preview?contractId&conditionGrade&appraisalPrice — spec 2026-09-20 §5.0 */
export class PreviewDeviceReturnQueryDto {
  @IsUUID(undefined, { message: 'กรุณาระบุสัญญา' })
  contractId: string;

  @IsOptional()
  @IsIn(CONDITION_GRADES, { message: 'เกรดสภาพต้องเป็น A, B, C, D' })
  conditionGrade?: ConditionGradeCode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'ราคาประเมินต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice?: number;
}
