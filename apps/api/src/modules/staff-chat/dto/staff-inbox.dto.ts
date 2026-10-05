import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
export class StaffInboxQueryDto {
  @IsIn(['SHOP', 'FINANCE'], { message: 'กรุณาเลือกบริษัท' })
  company!: 'SHOP' | 'FINANCE';
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
}
