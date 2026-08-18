import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsDateString, Max, Min } from 'class-validator';

export class QueryImportedSalesDto {
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() saleChannel?: string;
  @IsOptional() @IsString() salespersonName?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit = 50;
}
