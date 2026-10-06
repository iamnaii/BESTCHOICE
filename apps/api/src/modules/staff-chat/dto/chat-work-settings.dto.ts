import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CHAT_WORK_FLAGS, ChatWorkFlag } from '@installment/shared';
export class ChatWorkFlagDto {
  @IsIn(CHAT_WORK_FLAGS) key!: ChatWorkFlag;
  @IsBoolean() enabled!: boolean;
}
export class UpdateChatWorkSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(1440) ownerMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) managerMinutes?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique((item: ChatWorkFlagDto) => item.key)
  @ValidateNested({ each: true })
  @Type(() => ChatWorkFlagDto)
  flags?: ChatWorkFlagDto[];
}
