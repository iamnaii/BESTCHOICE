import { IsString, IsOptional } from 'class-validator';

export class CreateBranchDto {
  @IsString({ message: 'กรุณาระบุชื่อสาขา' })
  name: string;

  @IsString({ message: 'กรุณาระบุที่ตั้ง' })
  @IsOptional()
  location?: string;

  @IsString({ message: 'กรุณาระบุเบอร์โทร' })
  @IsOptional()
  phone?: string;
}
