import { IsString, IsUUID, IsOptional, MinLength, IsEnum, IsNumber, Min } from 'class-validator';

enum RepairPayerInput {
  SHOP = 'SHOP',
  CUSTOMER = 'CUSTOMER',
  SUPPLIER_CLAIM = 'SUPPLIER_CLAIM',
}

export class CreateRepairTicketDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  deviceBrand?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  deviceImei?: string;

  @IsOptional()
  @IsString()
  deviceSerial?: string;

  @IsString()
  @MinLength(5, { message: 'อาการเสียต้องระบุอย่างน้อย 5 ตัวอักษร' })
  defectDescription!: string;

  @IsOptional()
  @IsUUID()
  repairSupplierId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number;

  @IsOptional()
  @IsEnum(RepairPayerInput)
  payer?: RepairPayerInput;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsUUID()
  branchId!: string;
}
