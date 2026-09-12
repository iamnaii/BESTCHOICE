import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContractStatus, ContractWorkflowStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ContractsListQueryDto extends PaginationDto {
  @IsOptional() @IsIn(Object.values(ContractStatus)) status?: string;
  @IsOptional() @IsIn(Object.values(ContractWorkflowStatus)) workflowStatus?: string;
  @IsOptional() @IsString() @MaxLength(128) branchId?: string;
  @IsOptional() @IsString() @MaxLength(128) customerId?: string;
  @IsOptional() @IsString() @MaxLength(128) salespersonId?: string;
  @IsOptional() @IsString() @MaxLength(500) search?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}
