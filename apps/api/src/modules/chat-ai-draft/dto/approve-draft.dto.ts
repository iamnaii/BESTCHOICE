import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ApproveDraftDto {
  @IsUUID()
  draftMessageId: string;

  @IsOptional()
  @IsString()
  editedText?: string;
}
