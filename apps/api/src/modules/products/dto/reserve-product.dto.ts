import { IsOptional, IsString } from 'class-validator';

export class ReserveProductDto {
  @IsOptional()
  @IsString({ message: 'เหตุผลต้องเป็นข้อความ' })
  reason?: string;
}
