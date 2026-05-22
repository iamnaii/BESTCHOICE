import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateRateFactorDto {
  @IsInt()
  @Min(1)
  @Max(36)
  months!: number;

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
  @IsNumber({ maxDecimalPlaces: 6 })
  factor?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  feePerInstallment?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
