import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

// === Template DTOs ===
export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  deviceType: string;
}

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  deviceType?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateTemplateItemDto {
  @IsString()
  category: string;

  @IsString()
  itemName: string;

  @IsString()
  scoreType: string; // PASS_FAIL, GRADE, SCORE_1_5, NUMBER

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateTemplateItemDto {
  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  itemName?: string;

  @IsString()
  @IsOptional()
  scoreType?: string;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

// === Inspection DTOs ===
export class CreateInspectionDto {
  @IsString()
  productId: string;

  @IsString()
  templateId: string;
}

export class InspectionResultDto {
  @IsString()
  templateItemId: string;

  @IsBoolean()
  @IsOptional()
  passFail?: boolean;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsNumber()
  @IsOptional()
  score?: number;

  @IsNumber()
  @IsOptional()
  numberValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateInspectionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionResultDto)
  results: InspectionResultDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];
}

export class OverrideGradeDto {
  @IsString()
  grade: string;

  @IsString()
  reason: string;
}
