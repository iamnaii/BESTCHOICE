import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class SaveSignatureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000) // ~375KB base64 image max
  @Matches(/^data:image\/(png|jpeg|svg\+xml);base64,/, {
    message: 'signatureImage must be a valid base64 data URI (png, jpeg, or svg)',
  })
  signatureImage: string;
}
