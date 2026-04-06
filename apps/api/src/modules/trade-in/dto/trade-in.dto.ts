import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateTradeInDto {
  @IsString({ message: 'กรุณาระบุรหัสลูกค้า' })
  customerId: string;

  @IsString()
  @IsOptional()
  productId?: string;

  @IsString({ message: 'กรุณาระบุยี่ห้อเครื่อง' })
  deviceBrand: string;

  @IsString({ message: 'กรุณาระบุรุ่นเครื่อง' })
  deviceModel: string;

  @IsString()
  @IsOptional()
  deviceStorage?: string;

  @IsString()
  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A, B, C หรือ D' })
  deviceCondition?: string;

  @IsString()
  @IsOptional()
  imei?: string;

  @IsNumber({}, { message: 'ราคาประเมินต้องเป็นตัวเลข' })
  @IsOptional()
  estimatedValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AppraiseTradeInDto {
  @IsNumber({}, { message: 'กรุณาระบุราคาที่เสนอ' })
  offeredPrice: number;

  @IsString({ message: 'กรุณาระบุสภาพเครื่อง' })
  deviceCondition: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
