import { IsString } from 'class-validator';

export class VoidReceiptDto {
  @IsString({ message: 'กรุณาระบุเหตุผลในการยกเลิก' })
  reason: string;
}
