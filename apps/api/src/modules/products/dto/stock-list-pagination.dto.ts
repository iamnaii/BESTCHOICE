import { STOCK_SORT_KEYS, type StockSortKey, type StockSortDirection } from '@installment/shared';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class StockListPaginationDto extends PaginationDto {
  @IsOptional()
  @IsIn(STOCK_SORT_KEYS, { message: 'คอลัมน์ที่ใช้เรียงข้อมูลไม่ถูกต้อง' })
  sortBy?: StockSortKey;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'ทิศทางการเรียงข้อมูลไม่ถูกต้อง' })
  sortDirection?: StockSortDirection;

  @IsOptional()
  @IsIn(['true', 'false'], { message: 'รูปแบบการรวมอุปกรณ์ไม่ถูกต้อง' })
  groupAccessories?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{32}$/, { message: 'รหัสกลุ่มอุปกรณ์ไม่ถูกต้อง' })
  accessoryGroupId?: string;
}
