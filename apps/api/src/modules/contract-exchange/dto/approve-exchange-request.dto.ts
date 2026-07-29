import { IsOptional, IsBoolean } from 'class-validator';

export class ApproveExchangeRequestDto {
  /** MEMO mode: ยืนยันพิมพ์+เซ็นบันทึกแนบท้ายสัญญา (ContractDocumentType.ADDENDUM มีอยู่แล้ว) */
  @IsOptional()
  @IsBoolean()
  memoAddendumSigned?: boolean;

  /** MEMO mode: ยืนยันถอน MDM เครื่องเก่า + ลงทะเบียน MDM เครื่องใหม่แล้ว */
  @IsOptional()
  @IsBoolean()
  memoMdmSwapped?: boolean;
}
