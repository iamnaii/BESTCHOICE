import { IsIn, IsOptional } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(['30d', '90d'], { message: 'range ต้องเป็น 30d หรือ 90d' })
  range?: '30d' | '90d';
}
