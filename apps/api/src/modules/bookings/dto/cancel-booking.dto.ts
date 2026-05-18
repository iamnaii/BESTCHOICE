import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelBookingDto {
  @IsOptional()
  @IsString({ message: 'cancelReason ต้องเป็น string' })
  @MaxLength(500, { message: 'cancelReason ยาวไม่เกิน 500 ตัวอักษร' })
  cancelReason?: string;
}
