import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SetAliasDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ channel' })
  @IsIn(['shop', 'finance'], { message: 'channel ต้องเป็น shop หรือ finance' })
  channel!: 'shop' | 'finance';

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ variant' })
  @IsIn(['default', 'verified'], { message: 'variant ต้องเป็น default หรือ verified' })
  variant!: 'default' | 'verified';
}
