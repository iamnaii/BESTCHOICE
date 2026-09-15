import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { JOURNEY_EVENT_GROUPS, type JourneyEventGroup } from '@installment/shared';

/** csv หรือ key ซ้ำ → string[] (ท่าเดียวกับ splitCsv ของ overdue/dto/queue-query.dto.ts:62-70) */
function splitCsv(value: unknown): unknown {
  const parts = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : null;
  return parts ? parts.flatMap((p) => p.split(',')).map((p) => p.trim()).filter(Boolean) : value;
}

/** include ของหน้าแรก — summary = แนบ JourneySummary (คงไว้ตามแบบ เฟส 1 เว็บยังไม่ใช้) · counts = ตัวเลขบนชิปกรอง (แท็บการเดินทางขอ การ์ดภาพรวมไม่ขอ) */
export const JOURNEY_LIST_INCLUDES = ['summary', 'counts'] as const;
export type JourneyListInclude = (typeof JOURNEY_LIST_INCLUDES)[number];

/** GET /customers/:id/journey — ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS (shared) · Task 9 เพิ่ม include */
export class JourneyListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 30;
  /** base64('isoTs|eventId') จาก nextCursor */
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[A-Za-z0-9+/]+={0,2}$/) cursor?: string;
  @IsOptional() @Transform(({ value }) => splitCsv(value)) @IsArray() @ArrayMaxSize(JOURNEY_EVENT_GROUPS.length) @IsIn([...JOURNEY_EVENT_GROUPS], { each: true })
  groups?: JourneyEventGroup[];
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  /** csv (summary,counts) — มีผลเฉพาะหน้าแรก (ไม่มี cursor) */
  @IsOptional() @Transform(({ value }) => splitCsv(value)) @IsArray() @ArrayMaxSize(JOURNEY_LIST_INCLUDES.length) @IsIn([...JOURNEY_LIST_INCLUDES], { each: true })
  include?: JourneyListInclude[];
}
