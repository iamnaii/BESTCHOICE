import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Predefined snooze durations. Frontend renders these as preset buttons; the
 * backend translates them into a concrete `snoozedUntil` timestamp at write
 * time so the wall-clock semantics ("tomorrow 09:00 Bangkok") are computed
 * server-side and immune to client-clock skew / timezone bugs.
 *
 * `CUSTOM` requires the caller to supply `snoozedUntil` directly.
 */
export enum SnoozeDuration {
  ONE_HOUR = '1h',
  TWO_HOURS = '2h',
  TOMORROW_9AM = 'tomorrow_9am',
  NEXT_WEEK = 'next_week',
  CUSTOM = 'custom',
}

export class CreateSnoozeDto {
  @IsEnum(SnoozeDuration, { message: 'duration ไม่ถูกต้อง' })
  duration!: SnoozeDuration;

  // Required only when duration === CUSTOM. ISO 8601 string in any timezone;
  // the service rejects values that aren't strictly in the future.
  @ValidateIf((o) => o.duration === SnoozeDuration.CUSTOM)
  @IsISO8601({}, { message: 'snoozedUntil ต้องเป็นเวลา ISO 8601' })
  snoozedUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'เหตุผลยาวเกินไป (จำกัด 200 ตัวอักษร)' })
  reason?: string;
}
