import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QuoteAnswerDto } from '../../shop-buyback/dto/quote.dto';

export class AppraiseOnlineDto {
  @IsIn(['AS_ANSWERED', 'REVISED', 'MANUAL'], { message: 'mode ไม่ถูกต้อง' })
  mode!: 'AS_ANSWERED' | 'REVISED' | 'MANUAL';

  /** REVISED: คำตอบชุดใหม่ที่ staff แก้หน้างาน */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers?: QuoteAnswerDto[];

  /** MANUAL (OWNER เท่านั้น): ราคา free-hand */
  @IsOptional()
  @IsNumber({}, { message: 'กรุณาระบุราคา' })
  offeredPrice?: number;

  /** MANUAL: เหตุผล ≥ 3 ตัวอักษร (audited) */
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
