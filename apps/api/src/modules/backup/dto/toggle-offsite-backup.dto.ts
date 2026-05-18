import { IsBoolean } from 'class-validator';

export class ToggleOffsiteBackupDto {
  @IsBoolean({ message: 'enabled ต้องเป็น boolean' })
  enabled!: boolean;
}
