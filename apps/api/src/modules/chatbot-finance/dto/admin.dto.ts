import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
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
