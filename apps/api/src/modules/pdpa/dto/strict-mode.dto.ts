import { IsBoolean } from 'class-validator';

export class SetStrictModeDto {
  @IsBoolean({ message: 'enabled ต้องเป็น boolean' })
  enabled: boolean;
}
