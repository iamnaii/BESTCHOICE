import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class CreateApplicationDto {
  @IsUUID('all', { message: 'productId ไม่ถูกต้อง' })
  productId!: string;

  @IsOptional()
  @IsUUID('all', { message: 'reservationId ไม่ถูกต้อง' })
  reservationId?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ-นามสกุล' })
  fullName!: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'เบอร์โทร 10 หลัก' })
  phone!: string;

  @IsString()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชน 13 หลัก' })
  nationalId!: string;

  @IsInt({ message: 'ยอดดาวน์ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'ยอดดาวน์ต้องไม่ติดลบ' })
  proposedDownPayment!: number;

  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(3, { message: 'จำนวนงวดอย่างน้อย 3 งวด' })
  @Max(12, { message: 'จำนวนงวดสูงสุด 12 งวด' })
  proposedTotalMonths!: number;

  @IsOptional()
  @IsString()
  lineUserId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
