import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuoteAnswerDto } from '../../shop-buyback/dto/quote.dto';

export class AppraisalPreviewDto {
  @IsOptional()
  @IsBoolean({ message: 'กรุณายืนยันเงื่อนไขรับซื้อ' })
  deviceEligibilityConfirmed?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers!: QuoteAnswerDto[];
}

export class QuickBuyPreviewDto extends AppraisalPreviewDto {
  @IsIn(['Apple'], { message: 'รองรับเฉพาะ Apple iPhone' })
  deviceBrand!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกรุ่นเครื่อง' })
  deviceModel!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกความจุเครื่อง' })
  deviceStorage!: string;
}

export class AppraiseOnlineDto {
  @IsOptional()
  @IsBoolean({ message: 'กรุณายืนยันเงื่อนไขรับซื้อ' })
  deviceEligibilityConfirmed?: boolean;

  @IsIn(['AS_ANSWERED', 'REVISED', 'MANUAL'], { message: 'mode ไม่ถูกต้อง' })
  mode!: 'AS_ANSWERED' | 'REVISED' | 'MANUAL';

  /** REVISED: คำตอบชุดใหม่ที่ staff แก้หน้างาน */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers?: QuoteAnswerDto[];

  /** Fingerprint of the server preview; required for a first questionnaire appraisal. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'ข้อมูลตัวอย่างราคาไม่ถูกต้อง กรุณาประเมินใหม่' })
  previewToken?: string;

  /** MANUAL (OWNER เท่านั้น): ราคา free-hand */
  @IsOptional()
  @IsNumber({}, { message: 'กรุณาระบุราคา' })
  @Min(1, { message: 'กรุณาระบุราคาที่ถูกต้อง' })
  offeredPrice?: number;

  /** MANUAL: เหตุผล ≥ 3 ตัวอักษร (audited) */
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** AS_ANSWERED บน record เทิร์น: ลูกค้าไม่ซื้อเครื่อง → ถอยเป็นราคาเงินสด + flip flow เป็น BUYBACK */
  @IsOptional()
  @IsBoolean()
  useCashPrice?: boolean;
}
