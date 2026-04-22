import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SubmitBuybackDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุยี่ห้อ' })
  brand!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุความจุ' })
  storage!: string;

  @IsIn(['A', 'B', 'C'], { message: 'สภาพเครื่องต้องเป็น A, B หรือ C' })
  condition!: 'A' | 'B' | 'C';

  @IsInt({ message: 'เปอร์เซ็นต์แบตเตอรี่ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'เปอร์เซ็นต์แบตเตอรี่ต้องไม่น้อยกว่า 0' })
  @Max(100, { message: 'เปอร์เซ็นต์แบตเตอรี่ต้องไม่เกิน 100' })
  batteryHealth!: number;

  @IsArray({ message: 'กรุณาอัปโหลดรูปอย่างน้อย 1 รูป' })
  @ArrayMinSize(1, { message: 'กรุณาอัปโหลดรูปอย่างน้อย 1 รูป' })
  @ArrayMaxSize(8, { message: 'อัปโหลดรูปได้สูงสุด 8 รูป' })
  @IsString({ each: true })
  photoUrls!: string[];

  @IsOptional()
  @IsString()
  imei?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อผู้ขาย' })
  sellerName!: string;

  @IsString()
  @Matches(/^0\d{9}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0' })
  sellerPhone!: string;

  @IsOptional()
  @IsString()
  lineUserId?: string;
}
