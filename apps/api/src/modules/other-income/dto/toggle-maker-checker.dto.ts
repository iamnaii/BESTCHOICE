import { IsBoolean } from 'class-validator';

export class ToggleMakerCheckerDto {
  @IsBoolean({ message: 'enabled ต้องเป็น boolean' })
  enabled!: boolean;
}
