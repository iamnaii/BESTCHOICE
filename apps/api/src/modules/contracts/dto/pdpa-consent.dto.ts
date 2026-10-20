import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
export class PdpaConsentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(3 * 1024 * 1024)
  signatureImage: string;
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  presentedNoticeVersion: string;
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  presentedNoticeDigest: string;
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  acceptedPurposes: string[];
}
