import { ShopCashDestination } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_REFERENCE_LENGTH, MIN_REFERENCE_LENGTH } from '../shop-tender.util';

const MAX_AMOUNT = 99_999_999.99;

export class CountCashCloseDto {
  // ไม่ใช้ IsUUID: สาขาจาก seed/ข้อมูลเก่ามี id ที่ไม่ใช่ UUID (เช่น `branch-002`) — service ตรวจเองว่าสาขามีจริงและเป็นสาขาของผู้นับ
  @IsString({ message: 'กรุณาเลือกสาขา' })
  @IsNotEmpty({ message: 'กรุณาเลือกสาขา' })
  branchId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ยอดที่นับได้ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'ยอดที่นับได้ต้องไม่ติดลบ' })
  @Max(MAX_AMOUNT, { message: 'ยอดที่นับได้สูงเกินไป' })
  countedAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'เหตุผลของส่วนต่างยาวเกิน 500 ตัวอักษร' })
  varianceReason?: string;
}

export class ConfirmCashCloseDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'เงินที่รับมาจริงต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'เงินที่รับมาจริงต้องไม่ติดลบ' })
  @Max(MAX_AMOUNT, { message: 'เงินที่รับมาจริงสูงเกินไป' })
  receivedAmount!: number;

  @IsEnum(ShopCashDestination, { message: 'กรุณาเลือกว่านำเงินไปไว้ที่ไหน' })
  destination!: ShopCashDestination;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;

  /** บังคับเมื่อปลายทาง = นำฝากธนาคาร และมีเงินรับจริง (service ตรวจ — ต้องแนบรูปสลิปก่อนด้วย) */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_LENGTH, { message: `เลขอ้างอิงในสลิปยาวเกิน ${MAX_REFERENCE_LENGTH} ตัว` })
  depositReference?: string;
}

export class SendBackCashCloseDto {
  @IsString()
  @IsNotEmpty({ message: 'กรอกเหตุผลที่ตีกลับให้นับใหม่' })
  @MaxLength(500, { message: 'เหตุผลยาวเกิน 500 ตัวอักษร' })
  reason!: string;
}

/** แหล่งเงินที่ "บันทึกนำฝาก" ได้ — เงินที่รับจากการปิดยอดแล้วแต่ยังไม่เข้าธนาคาร */
export const CASH_DEPOSIT_SOURCES = ['BRANCH_SAFE', 'OWNER_HOLD'] as const;
export type CashDepositSource = (typeof CASH_DEPOSIT_SOURCES)[number];

/** multipart (แนบรูปสลิปในคำขอเดียวกัน) — ตัวเลขมาเป็น string แล้ว ValidationPipe แปลงให้ (`enableImplicitConversion`) */
export class CreateCashDepositDto {
  @IsString({ message: 'กรุณาเลือกสาขา' })
  @IsNotEmpty({ message: 'กรุณาเลือกสาขา' })
  branchId!: string;

  @IsIn(CASH_DEPOSIT_SOURCES, { message: 'เลือกที่มาของเงินเป็นตู้เซฟสาขา หรือเงินที่เจ้าของเก็บไว้' })
  source!: CashDepositSource;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ยอดนำฝากต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0.01, { message: 'ยอดนำฝากต้องมากกว่า 0' })
  @Max(MAX_AMOUNT, { message: 'ยอดนำฝากสูงเกินไป' })
  amount!: number;

  @IsString({ message: 'กรอกเลขอ้างอิงในสลิปฝากเงิน' })
  @MinLength(MIN_REFERENCE_LENGTH, { message: `เลขอ้างอิงในสลิปต้องมีอย่างน้อย ${MIN_REFERENCE_LENGTH} ตัว` })
  @MaxLength(MAX_REFERENCE_LENGTH, { message: `เลขอ้างอิงในสลิปยาวเกิน ${MAX_REFERENCE_LENGTH} ตัว` })
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;
}
