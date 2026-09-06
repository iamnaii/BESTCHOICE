import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class SessionQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unassignedOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  // NOT @Type(() => Boolean): Boolean('false') === true. Coerce explicitly so
  // ?unreadOnly=false means false.
  @Transform(({ value }) => value === true || value === 'true')
  unreadOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  // แท็บ "รอตอบ" — coerce แบบเดียวกับ unreadOnly (ห้าม @Type(() => Boolean))
  @Transform(({ value }) => value === true || value === 'true')
  waiting?: boolean;

  @IsOptional()
  @IsBoolean()
  // เฉพาะห้องที่ยังไม่ปิดงาน (resolvedAt ว่าง) — แท็บ "ของฉัน" = งานที่ยังเปิดของฉัน (เจ้าของเคาะ 2026-09-06)
  @Transform(({ value }) => value === true || value === 'true')
  openOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  // มุมมอง "ตอบไม่ทัน" (สเปก §7 แก้ไข 2026-09-05) — FACEBOOK ที่รออยู่แต่พ้นหน้าต่าง 24 ชม. · coerce แบบเดียวกับ waiting
  @Transform(({ value }) => value === true || value === 'true')
  expired?: boolean;

  @IsOptional()
  @IsString()
  channels?: string; // comma-separated list, e.g. "LINE_FINANCE,FACEBOOK"

  @IsOptional()
  @IsString()
  aiStatus?: string; // 'ai' | 'human' | 'pending'

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 50;
}
