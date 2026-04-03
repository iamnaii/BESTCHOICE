import { IsString, IsNotEmpty, IsNumber, Min, Max, Matches, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, { message: 'fileUrl ต้องเป็น HTTPS URL' })
  fileUrl: string;

  @IsString()
  @Matches(/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/, {
    message: 'mimeType ต้องเป็น image/jpeg, image/png, image/webp, image/heic หรือ application/pdf',
  })
  mimeType: string;

  @IsNumber()
  @Min(1, { message: 'ขนาดไฟล์ต้องมากกว่า 0' })
  @Max(10 * 1024 * 1024, { message: 'ขนาดไฟล์ต้องไม่เกิน 10MB' })
  fileSize: number;
}

export class DeleteDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, { message: 'fileUrl ต้องเป็น HTTPS URL' })
  fileUrl: string;
}
