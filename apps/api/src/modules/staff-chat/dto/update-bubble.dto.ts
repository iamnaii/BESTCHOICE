import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';

/**
 * Update payload for an existing CannedResponseBubble.
 *
 * Deliberately omits: `id`, `cannedResponseId`, `type`, `deletedAt`,
 * `createdAt`, `updatedAt` — these are not updatable via this endpoint.
 * Combined with the global `ValidationPipe({ whitelist: true })`, any extra
 * fields in the body are stripped before reaching the service.
 */
export class UpdateBubbleDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stickerPackageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stickerId?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationTitle?: string;

  @IsOptional()
  @IsObject()
  json?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
