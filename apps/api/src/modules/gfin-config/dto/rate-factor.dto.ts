import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateRateFactorDto {
  @IsInt()
  @Min(1)
  @Max(36)
  months!: number;

  /** % คอมมิชชั่นที่ร้านเลือกในหน้า GFIN (มือถือ 15 · iPad 5) — default 15 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  shopCommissionPct?: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  factor!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  feePerInstallment?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRateFactorDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  shopCommissionPct?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  factor?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  feePerInstallment?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
