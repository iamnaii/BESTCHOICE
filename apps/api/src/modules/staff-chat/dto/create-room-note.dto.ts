import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
export class CreateRoomNoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
  @ValidateIf((_o, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  mentionedUserIds?: string[];
  @ValidateIf((_o, value) => value !== undefined) @IsUUID() clientRequestId?: string;
}

export class RoomNoteScopeDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(['SHOP', 'FINANCE'])
  company?: 'SHOP' | 'FINANCE';
  @IsOptional() @IsUUID() branchId?: string;
}
