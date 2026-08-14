import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListEquityDto {
  @IsOptional()
  @IsIn(['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_DEC', 'DIV_PAY', 'PRIOR_ADJ'])
  txnType?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'READY', 'POSTED', 'REVERSED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
