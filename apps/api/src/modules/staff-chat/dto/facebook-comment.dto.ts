import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { StaffInboxQueryDto } from './staff-inbox.dto';
export class FacebookCommentQueryDto extends StaffInboxQueryDto {
  @IsOptional() @IsIn(['OPEN', 'RESPONDED', 'RESOLVED']) status?: 'OPEN' | 'RESPONDED' | 'RESOLVED';
}
export class CommentRevisionDto {
  @IsInt() @Min(0) expectedRevision!: number;
}
export class AssignFacebookCommentDto extends CommentRevisionDto {
  @ValidateIf((_object, value) => value !== null) @IsUUID() assigneeId!: string | null;
}
export class StatusFacebookCommentDto extends CommentRevisionDto {
  @IsIn(['OPEN', 'RESOLVED']) status!: 'OPEN' | 'RESOLVED';
}
export class LinkFacebookCommentDto extends CommentRevisionDto {
  @ValidateIf((_object, value) => value !== null) @IsUUID() customerId!: string | null;
  @ValidateIf((_object, value) => value !== null) @IsUUID() roomId!: string | null;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
export class ConfigureFacebookCommentPageDto {
  @IsUUID() branchId!: string;
  @IsBoolean() enabled!: boolean;
}
