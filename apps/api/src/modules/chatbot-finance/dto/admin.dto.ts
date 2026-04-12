import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListSessionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit = 20;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean()
  handoffOnly?: boolean;
}

export class CreateKbDto {
  @IsString() intent!: string;
  @IsString() category!: string;
  @IsArray() @IsString({ each: true }) triggerKeywords!: string[];
  @IsArray() @IsString({ each: true }) exampleQuestions!: string[];
  @IsString() responseTemplate!: string;
  @IsString() responseType!: string;
  @IsOptional() @IsBoolean() requiresAuth?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) requiresTools?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() priority?: number;
}

export class UpdatePromptDto {
  @IsString({ message: 'กรุณาระบุ prompt' })
  @MinLength(100, { message: 'Prompt ต้องมีอย่างน้อย 100 ตัวอักษร' })
  @MaxLength(10000, { message: 'Prompt ต้องไม่เกิน 10,000 ตัวอักษร' })
  prompt!: string;
}

export class UpdateKbDto {
  @IsOptional() @IsString() intent?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) triggerKeywords?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) exampleQuestions?: string[];
  @IsOptional() @IsString() responseTemplate?: string;
  @IsOptional() @IsString() responseType?: string;
  @IsOptional() @IsBoolean() requiresAuth?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) requiresTools?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() priority?: number;
}
