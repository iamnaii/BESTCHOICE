import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/** โคลนสูตร toBool จาก list-cases.dto.ts — query param เป็น string เสมอ ('true'/'false') */
function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

export class ReplacementProductsDto {
  @IsString()
  @MinLength(4, { message: 'IMEI อย่างน้อย 4 ตัว' })
  imei!: string;

  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  sameModel!: boolean;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
