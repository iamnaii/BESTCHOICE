import { IsIn, IsOptional } from 'class-validator';

export class KpiQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d'], { message: 'range ต้องเป็น 7d หรือ 30d' })
  range?: '7d' | '30d';
}
