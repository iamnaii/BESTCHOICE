import { IsNotEmpty, IsString } from 'class-validator';

export class PdpaConsentDto {
  @IsNotEmpty({ message: 'กรุณาระบุรูปลายเซ็น' })
  @IsString({ message: 'รูปลายเซ็นต้องเป็นข้อความ' })
  signatureImage: string;
}
