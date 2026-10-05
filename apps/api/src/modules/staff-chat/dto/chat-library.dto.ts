import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { StaffInboxQueryDto } from './staff-inbox.dto';
export class LibraryQueryDto extends StaffInboxQueryDto {
  @IsOptional() @IsUUID() folderId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['image', 'pdf']) kind?: 'image' | 'pdf';
}
export class CreateLibraryFolderDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
}
export class UploadLibraryFileDto {
  @IsUUID() requestKey!: string;
  @IsOptional() @IsUUID() folderId?: string;
}
