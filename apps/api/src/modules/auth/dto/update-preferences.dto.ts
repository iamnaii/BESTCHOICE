import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @IsIn(['SESSION', 'LIBRARY'])
  collectionsDefaultView?: 'SESSION' | 'LIBRARY';
}
