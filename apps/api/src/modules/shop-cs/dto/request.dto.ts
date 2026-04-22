import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CancelOrderDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  reason!: string;
}

export class RefundRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsIn(['FULL', 'PARTIAL'], { message: 'ประเภทการคืนเงินไม่ถูกต้อง' })
  type!: 'FULL' | 'PARTIAL';
}
