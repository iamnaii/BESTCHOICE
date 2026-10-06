import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  ValidateIf,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { TodoStatus } from '@prisma/client';
export class CreateChatFollowUpDto {
  @IsUUID() clientRequestId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
  @IsUUID() assigneeId!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt!: string;
}
export class UpdateChatFollowUpDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() assigneeId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['TODO', 'DOING', 'REVIEW', 'DONE', 'CANCELLED'])
  status?: TodoStatus;
}
