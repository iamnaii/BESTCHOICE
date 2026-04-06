import { IsOptional, IsString } from 'class-validator';

export class RejectTransferDto {
  @IsOptional()
  @IsString({ message: 'เหตุผลต้องเป็นข้อความ' })
  reason?: string;
}
