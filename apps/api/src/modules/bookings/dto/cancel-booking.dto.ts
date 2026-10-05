import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelBookingDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  @MinLength(3, { message: 'กรุณาระบุเหตุผลการยกเลิก (อย่างน้อย 3 ตัวอักษร)' })
  @MaxLength(500, { message: 'cancelReason ยาวไม่เกิน 500 ตัวอักษร' })
  cancelReason!: string;
}
