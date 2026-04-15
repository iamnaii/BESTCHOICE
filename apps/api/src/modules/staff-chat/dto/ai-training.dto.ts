import { IsString, IsOptional, IsIn } from 'class-validator';

export class SaveFeedbackDto {
  @IsString()
  sessionId: string;

  @IsIn(['ACCEPT', 'EDIT', 'REJECT'])
  type: 'ACCEPT' | 'EDIT' | 'REJECT';

  @IsString()
  customerMessage: string;

  @IsString()
  @IsOptional()
  aiDraft?: string;

  @IsString()
  @IsOptional()
  humanEdit?: string;

  @IsString()
  @IsOptional()
  intent?: string;
}
