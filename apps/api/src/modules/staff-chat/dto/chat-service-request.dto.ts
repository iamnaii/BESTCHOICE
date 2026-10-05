import { StaffInboxQueryDto } from './staff-inbox.dto';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
export class CreateChatServiceRequestDto {
  @IsUUID() clientRequestId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  symptom!: string;
  @IsUUID() assigneeId!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt!: string;
  @ValidateIf((_o, v) => v !== undefined) @IsUUID() productId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsUUID() contractId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsUUID() saleId?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  sourceMessageIds?: string[];
}
export class UpdateChatServiceRequestDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  symptom?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['OPEN', 'WAITING_CUSTOMER', 'RESOLVED', 'CANCELLED'])
  status?: 'OPEN' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CANCELLED';
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsUUID() assigneeId?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string;
}

export class LinkChatServiceCaseDto {
  @IsUUID() caseId!: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class ServiceCaseOptionsDto extends StaffInboxQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(100) search?: string;
}
