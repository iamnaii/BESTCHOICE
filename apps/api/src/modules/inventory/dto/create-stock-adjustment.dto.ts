import { IsString, IsOptional, IsArray, IsIn, IsNotEmpty } from 'class-validator';

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรหัสสินค้า' })
  productId: string;

  @IsIn(['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'WRITE_OFF', 'OTHER'], { message: 'เหตุผลต้องเป็น DAMAGED, LOST, FOUND, CORRECTION, WRITE_OFF หรือ OTHER' })
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];

  // T5-C3 — every stock adjustment requires a second-person approver.
  // The service rejects any submission where approverId equals the caller
  // (the adjuster), or where the approver is not manager-tier.
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุผู้อนุมัติ (approverId)' })
  approverId: string;
}
