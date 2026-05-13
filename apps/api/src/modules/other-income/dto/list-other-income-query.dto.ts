import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OtherIncomeStatus } from '@prisma/client';

export class ListOtherIncomeQueryDto {
  @IsOptional()
  @IsEnum(OtherIncomeStatus)
  status?: OtherIncomeStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  q?: string;

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

  /**
   * Sort expression in the form `<field>:<asc|desc>`.
   * Supported fields: createdAt, issueDate.
   * Defaults to `issueDate:desc`.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(createdAt|issueDate):(asc|desc)$/, {
    message: 'sort ต้องอยู่ในรูปแบบ <field>:<direction> เช่น createdAt:desc (field=createdAt|issueDate, direction=asc|desc)',
  })
  sort?: string;
}
