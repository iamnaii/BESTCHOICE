import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsDateString,
  IsUUID,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TodoStatus, TodoPriority } from '@prisma/client';

export class TodosQueryDto {
  @IsOptional()
  @IsString()
  view?: 'all' | 'today' | 'upcoming' | 'priority' | 'completed';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TodoStatus)
  status?: TodoStatus;

  @IsOptional()
  @IsEnum(TodoPriority)
  priority?: TodoPriority;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class ChecklistItemDto {
  @IsString()
  id!: string;

  @IsString()
  text!: string;

  @IsOptional()
  done?: boolean;
}

export class CreateTodoDto {
  @IsString({ message: 'กรุณาระบุชื่องาน' })
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TodoStatus, { message: 'สถานะไม่ถูกต้อง' })
  status?: TodoStatus;

  @IsOptional()
  @IsEnum(TodoPriority, { message: 'ระดับความสำคัญไม่ถูกต้อง' })
  priority?: TodoPriority;

  @IsOptional()
  @IsDateString({}, { message: 'รูปแบบวันที่ครบกำหนดไม่ถูกต้อง' })
  dueDate?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'รหัสผู้รับมอบหมายไม่ถูกต้อง' })
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  checklist?: ChecklistItemDto[];

  @IsOptional()
  attachments?: unknown[];
}

export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TodoStatus)
  status?: TodoStatus;

  @IsOptional()
  @IsEnum(TodoPriority)
  priority?: TodoPriority;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  checklist?: ChecklistItemDto[];

  @IsOptional()
  attachments?: unknown[];
}
