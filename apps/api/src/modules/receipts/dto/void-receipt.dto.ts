import { IsString } from 'class-validator';

export class VoidReceiptDto {
  @IsString({ message: 'กรุณาระบุเหตุผลในการยกเลิก' })
  reason: string;

  // Segregation of duties: must be a different user from the requester.
  // OWNER bypass removed — every void requires an independent approver
  // to prevent fraud (one person cannot both request and approve).
  @IsString({ message: 'กรุณาระบุผู้อนุมัติการยกเลิก' })
  approvedById: string;
}
