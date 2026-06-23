import { IsArray, IsString, IsOptional, ArrayNotEmpty } from 'class-validator';

export class SettleFinanceDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุสัญญาอย่างน้อย 1 รายการ' })
  @IsString({ each: true })
  contractIds: string[];

  /** SHOP receiving bank (S11-12XX). Defaults to ShopAccountResolver.SHOP_RECEIVING_BANK. */
  @IsOptional()
  @IsString()
  bankAccountCode?: string;

  @IsOptional()
  @IsString()
  postedAt?: string;
}
