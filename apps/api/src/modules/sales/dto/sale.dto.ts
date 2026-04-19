import { IsString, IsOptional, IsNumber, IsEnum, IsIn, IsArray, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSaleDto {
  @IsEnum(['CASH', 'INSTALLMENT', 'EXTERNAL_FINANCE'], { message: 'กรุณาระบุประเภทการขาย' })
  saleType: string;

  @IsString({ message: 'กรุณาระบุลูกค้า' })
  customerId: string;

  @IsString({ message: 'กรุณาระบุสินค้า' })
  productId: string;

  @IsString({ message: 'กรุณาระบุสาขา' })
  branchId: string;

  @IsNumber({}, { message: 'กรุณาระบุราคาขาย' })
  @Type(() => Number)
  sellingPrice: number;

  @IsNumber({}, { message: 'กรุณาระบุส่วนลด' })
  @IsOptional()
  @Type(() => Number)
  discount?: number;

  // T5-C1 — when a discount exceeds the per-role soft threshold (10% for
  // non-OWNER roles), the caller must attach the userId of a second-person
  // approver (manager who pre-agreed to the discount in person).
  @IsString({ message: 'secondApproverId ต้องเป็นข้อความ' })
  @IsOptional()
  secondApproverId?: string;

  // Payment method (all sale types)
  @IsIn(['CASH', 'BANK_TRANSFER', 'QR_EWALLET'], { message: 'กรุณาระบุวิธีชำระเงิน' })
  @IsOptional()
  paymentMethod?: string;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนเงินที่รับ' })
  @IsOptional()
  @Type(() => Number)
  amountReceived?: number;

  // Down payment (for INSTALLMENT and EXTERNAL_FINANCE)
  @IsNumber({}, { message: 'กรุณาระบุเงินดาวน์' })
  @IsOptional()
  @Type(() => Number)
  downPayment?: number;

  // Contract number (for INSTALLMENT and EXTERNAL_FINANCE)
  @IsString({ message: 'กรุณาระบุเลขสัญญา' })
  @IsOptional()
  contractNumber?: string;

  // Installment fields
  @IsString({ message: 'กรุณาระบุประเภทแผน' })
  @IsOptional()
  planType?: string = 'STORE_DIRECT';

  @IsNumber({}, { message: 'กรุณาระบุจำนวนงวด' })
  @IsOptional()
  @Type(() => Number)
  totalMonths?: number;

  @IsNumber({}, { message: 'กรุณาระบุอัตราดอกเบี้ย' })
  @IsOptional()
  @Type(() => Number)
  interestRate?: number;

  // Payment due day (1-28) for custom salary-based due dates
  @IsInt({ message: 'กรุณาระบุวันครบกำหนดชำระ' })
  @Min(1, { message: 'วันครบกำหนดต้องไม่น้อยกว่า 1' })
  @Max(28, { message: 'วันครบกำหนดต้องไม่เกิน 28' })
  @IsOptional()
  @Type(() => Number)
  paymentDueDay?: number;

  // External finance fields
  @IsString({ message: 'กรุณาระบุบริษัทไฟแนนซ์' })
  @IsOptional()
  financeCompany?: string;

  @IsString({ message: 'กรุณาระบุเลขอ้างอิงไฟแนนซ์' })
  @IsOptional()
  financeRefNumber?: string;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนเงินไฟแนนซ์' })
  @IsOptional()
  @Type(() => Number)
  financeAmount?: number;

  // Bundle / freebie product IDs
  @IsArray({ message: 'กรุณาระบุรายการสินค้าแถม' })
  @IsString({ each: true, message: 'รหัสสินค้าแถมต้องเป็นข้อความ' })
  @IsOptional()
  bundleProductIds?: string[];

  @IsString({ message: 'กรุณาระบุหมายเหตุเป็นข้อความ' })
  @IsOptional()
  notes?: string;
}
