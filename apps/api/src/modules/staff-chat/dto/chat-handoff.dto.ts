import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { CreateChatFollowUpDto } from './chat-follow-up.dto';
export class CreateChatHandoffDto extends CreateChatFollowUpDto {
  @ValidateIf((_o, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(5000)
  note?: string;
}
export class UpdateChatHandoffDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsIn(['ACCEPT', 'COMPLETE', 'CANCEL']) action!: 'ACCEPT' | 'COMPLETE' | 'CANCEL';
  @ValidateIf((_o, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  completionNote?: string;
}
