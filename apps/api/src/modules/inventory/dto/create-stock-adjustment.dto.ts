import { IsString, IsOptional, IsArray, IsIn, IsNotEmpty, ArrayMinSize } from 'class-validator';

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรหัสสินค้า' })
  productId: string;

  @IsIn(['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'WRITE_OFF', 'OTHER'], { message: 'เหตุผลต้องเป็น DAMAGED, LOST, FOUND, CORRECTION, WRITE_OFF หรือ OTHER' })
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // T5-C14 — DAMAGED requires at least one photo as evidence. Enforced in the
  // service layer (after reason is known); DTO-level validator keeps the type
  // `string[]` when present so empty arrays are still shaped correctly.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMinSize(0)
  photos?: string[];

  // T5-C3 — every stock adjustment requires a second-person approver.
  // The service rejects any submission where approverId equals the caller
  // (the adjuster), or where the approver is not manager-tier.
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุผู้อนุมัติ (approverId)' })
  approverId: string;
}
