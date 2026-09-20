import { IsString, IsOptional, IsBoolean, IsUUID, Matches, IsNumber, Min, Max } from 'class-validator';

export class UpdateBranchDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isMainWarehouse?: boolean;

  /**
   * บริษัทที่สาขานี้สังกัด (SHOP / FINANCE).
   *
   * ปล่อยว่างไว้ = "orphan branch" ซึ่งทำให้สองอย่างพังเงียบ ๆ:
   *  - `e-tax.service.ts` ปฏิเสธการออกใบกำกับอิเล็กทรอนิกส์จากสาขานี้
   *  - `installment-accrual.cron.ts` ส่ง `companyId = undefined` เข้า
   *    `validatePeriodOpen` ซึ่งคืนค่าผ่านทันที ⇒ cron ดอกเบี้ยรายวันข้ามด่านงวดบัญชี
   *
   * เดิมไม่มีช่องนี้ใน DTO เลย ตั้งได้เฉพาะตอน seed (พบสาขาบน prod ที่ค่าเป็น null 2026-08-24).
   */
  @IsUUID(undefined, { message: 'companyId ต้องเป็น UUID ของบริษัทที่มีอยู่จริง' })
  @IsOptional()
  companyId?: string;

  /**
   * บัญชีเงินสด/ธนาคารฝั่ง SHOP ของสาขานี้ — ใช้เป็นลิ้นชักของสาขาเวลาขายสด
   * รับเงินดาวน์ และจ่ายค่ารับซื้อมือสองด้วยเงินสด
   *
   * **fail-closed**: `ShopAccountResolver.resolveBranchCashAccount` โยน 400 ทั้งใบเมื่อค่านี้ว่าง
   * ⇒ ไม่ตั้ง = ขายสดเงินสดไม่ได้ / รับเทิร์นจ่ายสดไม่ได้ / activate สัญญาที่มีเงินดาวน์สดไม่ได้
   *
   * ข้อความ error ของ resolver บอกให้ "set it in branch settings" — ก่อน 2026-08-24
   * ช่องนั้นไม่มีอยู่จริง (ตั้งได้เฉพาะ seed/เทส) จึงเพิ่มเข้ามาที่นี่
   *
   * รับเฉพาะรหัสฝั่ง SHOP: S11-1101..1103 (เงินสดสาขา) หรือ S11-1201..1202 (ธนาคาร SHOP)
   * — ใส่รหัส FINANCE (เลขล้วน) ไม่ได้ เพราะจะทำให้ JE ฝั่ง SHOP อ้างผังผิดสมุด
   */
  @Matches(/^S11-(110[1-3]|120[1-2])$/, {
    message: 'shopCashAccountCode ต้องเป็น S11-1101..1103 (เงินสดสาขา) หรือ S11-1201..1202 (ธนาคาร SHOP)',
  })
  @IsOptional()
  shopCashAccountCode?: string;

  /**
   * เงินทอนตั้งต้นของลิ้นชักสาขา (คำตัดสินเจ้าของ 2026-09-20) — ปิดยอดแล้วส่งเงินทั้งหมด เหลือยอดนี้คงที่ไว้ทอนวันถัดไป.
   * หน้านับเงินปิดยอดใช้เป็นฐานของ "ต้องมีในลิ้นชัก" (= เงินทอนตั้งต้น + รับเงินสด − จ่ายเงินสดออก). ไม่ตั้ง = 0
   */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'เงินทอนตั้งต้นต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'เงินทอนตั้งต้นต้องไม่ติดลบ' })
  @Max(1_000_000, { message: 'เงินทอนตั้งต้นสูงเกินไป' })
  @IsOptional()
  shopCashFloat?: number;
}
