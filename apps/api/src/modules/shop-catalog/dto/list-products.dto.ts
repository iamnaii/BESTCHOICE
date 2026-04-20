import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class ListProductsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 24;

  @IsOptional() @IsString()
  brand?: string;

  @IsOptional() @IsString()
  conditionGrade?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  minPrice?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxPrice?: number;

  @IsOptional() @IsEnum(['popular', 'price_asc', 'price_desc', 'newest'])
  sort?: 'popular' | 'price_asc' | 'price_desc' | 'newest' = 'popular';
}
