import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ReverseAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}

// Alias for backward compatibility with existing controller imports
export class DisposeAssetDto extends ReverseAssetDto {}
