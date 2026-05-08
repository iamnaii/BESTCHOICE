import { IsString, IsOptional, IsDateString, IsNotEmpty, MinLength } from 'class-validator';

export class TransferAssetDto {
  @IsDateString({}, { message: 'วันที่โอนไม่ถูกต้อง' })
  transferDate: string;

  @IsOptional() @IsString()
  toCustodian?: string;

  @IsOptional() @IsString()
  toLocation?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการโอน' })
  @MinLength(5)
  reason: string;
}
