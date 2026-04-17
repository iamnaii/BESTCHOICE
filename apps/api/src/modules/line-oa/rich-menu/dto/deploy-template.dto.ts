import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class DeployTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ template' })
  @IsIn(['finance-default', 'finance-verified'], {
    message: 'template ไม่ถูกต้อง',
  })
  templateKey!: 'finance-default' | 'finance-verified';
}

export class SetCallCenterPhoneDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ channel' })
  @IsIn(['shop', 'finance'], { message: 'channel ต้องเป็น shop หรือ finance' })
  channel!: 'shop' | 'finance';

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเบอร์โทร' })
  phone!: string;
}
