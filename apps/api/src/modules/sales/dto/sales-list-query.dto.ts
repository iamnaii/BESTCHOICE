import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ContractStatus, PaymentMethod, SaleType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SalesListQueryDto extends PaginationDto {
  @IsOptional() @IsIn(Object.values(SaleType)) saleType?: string;
  @IsOptional() @IsString() @MaxLength(128) branchId?: string;
  @IsOptional() @IsString() @MaxLength(500) search?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(128) salespersonId?: string;
  @IsOptional() @IsIn(Object.values(ContractStatus)) contractStatus?: string;
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  includeVoided?: boolean;
}
