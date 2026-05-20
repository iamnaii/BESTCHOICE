import { IsOptional, IsUUID } from 'class-validator';

export class WarrantyPreviewDto {
  @IsOptional()
  @IsUUID('all', { message: 'customerId ต้องเป็น UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'contractId ต้องเป็น UUID' })
  contractId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'productId ต้องเป็น UUID' })
  productId?: string;
}
