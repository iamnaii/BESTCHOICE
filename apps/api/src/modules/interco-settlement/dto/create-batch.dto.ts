import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — สร้าง/แก้ไข (DRAFT) รอบจ่าย.
 *
 * Reused verbatim by `IntercoSettlementService.updateBatch` (spec §6 "DRAFT
 * แก้ได้") — there is no separate UpdateBatchDto. On update, any field left
 * `undefined` is a Prisma update no-op (column untouched), so omitting an
 * optional field naturally preserves the batch's existing value.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §3, §6
 */
export class CreateBatchDto {
  @IsArray({ message: 'contractIds ต้องเป็น array' })
  @ArrayNotEmpty({ message: 'ต้องเลือกอย่างน้อย 1 สัญญา' })
  @IsUUID('4', { each: true, message: 'contractId แต่ละรายการต้องเป็น UUID' })
  contractIds!: string[];

  /** สัญญายกเลิก (C-2) ที่เลือกหักเรียกคืนในรอบนี้ — optional (Phase 2) */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'recallContractIds ต้องเป็น UUID' })
  recallContractIds?: string[];

  /** วันโอนจริงตาม statement — โหมดย้อนหลังได้ (D2/D4) */
  @IsDateString({}, { message: 'วันที่โอนไม่ถูกต้อง' })
  transferDate!: string;

  /** default '11-1201' ที่ service layer เมื่อสร้างใหม่ */
  @IsOptional()
  @IsString({ message: 'financeBankCode ต้องเป็นข้อความ' })
  @MaxLength(20)
  financeBankCode?: string;

  /** default ShopAccountResolver.SHOP_RECEIVING_BANK ('S11-1201') ที่ service layer เมื่อสร้างใหม่ */
  @IsOptional()
  @IsString({ message: 'shopBankCode ต้องเป็นข้อความ' })
  @MaxLength(20)
  shopBankCode?: string;

  @IsOptional()
  @IsString({ message: 'transferRef ต้องเป็นข้อความ' })
  @MaxLength(100)
  transferRef?: string;

  @IsOptional()
  @IsString({ message: 'slipFileKey ต้องเป็นข้อความ' })
  @MaxLength(500)
  slipFileKey?: string;

  @IsOptional()
  @IsString({ message: 'note ต้องเป็นข้อความ' })
  @MaxLength(1000)
  note?: string;
}
