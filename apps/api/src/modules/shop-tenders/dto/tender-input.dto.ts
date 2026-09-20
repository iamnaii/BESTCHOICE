import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { MAX_REFERENCE_LENGTH, TENDER_METHODS } from '../shop-tender.util';

/**
 * หนึ่งบรรทัดของ "ช่องรับเงิน" — กติกาเชิงธุรกิจ (ผลรวม, เลขอ้างอิงบังคับ, สูงสุด 4 บรรทัด)
 * อยู่ที่ `normalizeTenders` ที่เดียว; DTO ตรวจแค่รูปร่างข้อมูล.
 */
export class TenderInputDto {
  @IsIn(TENDER_METHODS, { message: 'วิธีรับเงินไม่ถูกต้อง เลือกได้เฉพาะเงินสด โอนธนาคาร หรือ QR / e-Wallet' })
  method!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFERENCE_LENGTH)
  reference?: string;
}
