import { IsString, Length } from 'class-validator';

export class RejectStockAdjustmentDto {
  @IsString()
  @Length(10, 500, { message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ 10–500 ตัวอักษร' })
  reason: string;
}
