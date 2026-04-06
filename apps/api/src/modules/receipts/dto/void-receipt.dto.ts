import { IsString, IsOptional } from 'class-validator';

export class VoidReceiptDto {
  @IsString({ message: 'กรุณาระบุเหตุผลในการยกเลิก' })
  reason: string;

  @IsOptional()
  @IsString()
  approvedById?: string; // ผู้อนุมัติการยกเลิก (���้าไม่ระบุ = ผู้ร้องขอเอง สำหรับ OWNER)
}
