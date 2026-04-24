import { IsString, IsUrl } from 'class-validator';

export class UpdateLetterEvidenceDto {
  @IsString({ message: 'กรุณาระบุ URL' })
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'URL ต้องเป็น https' },
  )
  evidencePhotoUrl: string;
}
