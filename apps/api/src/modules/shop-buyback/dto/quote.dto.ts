import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class QuoteAnswerDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุคำถาม' })
  questionKey!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique({ message: 'ตัวเลือกซ้ำกัน' })
  @IsString({ each: true })
  choiceIds!: string[];
}

export class BuybackQuoteDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุความจุ' })
  storage!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  @ArrayUnique((a: QuoteAnswerDto) => a.questionKey, { message: 'คำตอบซ้ำกัน กรุณาลองใหม่' })
  answers!: QuoteAnswerDto[];
}

export class SubmitBuybackDto extends BuybackQuoteDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อผู้ขาย' })
  sellerName!: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0' })
  sellerPhone!: string;

  @IsOptional()
  @IsString()
  imei?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  preferredVisitDate?: string;

  @IsOptional()
  @IsString()
  lineUserId?: string;

  /** ทางที่ลูกค้าเลือก — bundle เก่า (#1360) ไม่ส่ง = BUYBACK พฤติกรรมเดิมเป๊ะ */
  @IsOptional()
  @IsIn(['BUYBACK', 'EXCHANGE'], { message: 'ประเภทรายการไม่ถูกต้อง' })
  flow?: 'BUYBACK' | 'EXCHANGE';
}
