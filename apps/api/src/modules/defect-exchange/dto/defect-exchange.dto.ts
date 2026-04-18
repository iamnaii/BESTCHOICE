import { IsString, IsArray, IsOptional } from 'class-validator';

export class ExecuteDefectExchangeDto {
  @IsString({ message: 'กรุณาระบุสัญญาเดิม' })
  oldContractId: string;

  @IsString({ message: 'กรุณาระบุสินค้าใหม่' })
  newProductId: string;

  @IsString({ message: 'กรุณาระบุอาการเครื่องเสีย' })
  defectReason: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photoUrls?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
