import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ContractStatus, ProductCategory } from '@prisma/client';

// Overdue bucket codes (human-readable in URL query).
export enum OverdueBucket {
  B_1_7 = '1-7',
  B_8_30 = '8-30',
  B_31_60 = '31-60',
  B_61_90 = '61-90',
  B_90_PLUS = '90+',
}

// When was the customer last contacted via any channel.
export enum LastContactedBucket {
  TODAY = 'today',
  THIS_WEEK = 'this_week',
  NEVER = 'never',
  OVER_7_DAYS = 'over_7_days',
}

// LINE delivery state — derived from dunning action result + customer.lineId.
export enum LineResponseState {
  RESPONDED = 'responded',
  IGNORED = 'ignored',
  BLOCKED = 'blocked',
  NO_LINE = 'no_line',
}

// Coarse MDM lock state filter — maps to MdmLockStatus groups.
export enum MdmStateFilter {
  NOT_LOCKED = 'not_locked',
  LOCKED = 'locked',
  PENDING = 'pending',
}

// Sort options for the queue list. PRIORITY is the legacy default
// (computed score from outstanding × daysOverdue × broken-promise multiplier).
// RANDOM is a fair-rotation shuffle seeded by `userId-todayDate` so multiple
// collectors don't all start from the same top contract.
export enum QueueSortBy {
  PRIORITY = 'priority',
  OUTSTANDING_DESC = 'outstanding_desc',
  OUTSTANDING_ASC = 'outstanding_asc',
  DAYS_OVERDUE_DESC = 'days_overdue_desc',
  LAST_CONTACTED_ASC = 'last_contacted_asc',
  NAME_ASC = 'name_asc',
  RANDOM = 'random',
}

// CSV or array → string[] (express parses repeated keys differently based on
// query-parser; we accept both shapes).
function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

export class QueueQueryDto {
  @IsEnum(['today', 'promise'], { message: 'tab ต้องเป็น today หรือ promise' })
  tab!: 'today' | 'promise';

  // Existing
  @IsOptional()
  @IsString()
  branchId?: string;

  /** C1: server-side search by customer name / contractNumber / phone */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // --- New filter fields ---

  @IsOptional()
  @IsString()
  assignedToId?: string; // 'self' | 'unassigned' | UUID

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  showSkipTracing?: boolean;

  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsArray()
  @IsEnum(OverdueBucket, { each: true, message: 'bucket ไม่ถูกต้อง' })
  overdueBuckets?: OverdueBucket[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOutstanding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxOutstanding?: number;

  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsArray()
  @IsEnum(ContractStatus, { each: true, message: 'status ไม่ถูกต้อง' })
  contractStatuses?: ContractStatus[];

  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsArray()
  @IsEnum(ProductCategory, { each: true, message: 'ประเภทสินค้าไม่ถูกต้อง' })
  productTypes?: ProductCategory[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minLetterCount?: number;

  @IsOptional()
  @IsEnum(LastContactedBucket)
  lastContacted?: LastContactedBucket;

  @IsOptional()
  @IsEnum(LineResponseState)
  lineResponse?: LineResponseState;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBrokenPromise?: number;

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  hasActivePromise?: boolean;

  @IsOptional()
  @IsEnum(MdmStateFilter)
  mdmState?: MdmStateFilter;

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  slipReviewPending?: boolean;

  @IsOptional()
  @IsEnum(QueueSortBy, { message: 'sortBy ไม่ถูกต้อง' })
  sortBy?: QueueSortBy;
}
