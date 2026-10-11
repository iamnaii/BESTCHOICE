import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
export class RequestDto {
  @IsUUID() requestId!: string;
}
export class VersionDto extends RequestDto {
  @IsInt() @Min(1) version!: number;
}
export class PublicBookDto extends RequestDto {
  @IsUUID() branchId!: string;
  @IsDateString() startsAt!: string;
}
export class CreateAppointmentDto extends PublicBookDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() sourceRoomId?: string;
}
export class RescheduleDto extends VersionDto {
  @IsUUID() branchId!: string;
  @IsDateString() startsAt!: string;
}
export class ReassignDto extends VersionDto {
  @IsUUID() staffUserId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class StatusDto extends VersionDto {
  @IsIn(['CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELED', 'NO_SHOW']) status!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class WindowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsUUID() branchId!: string;
  @IsUUID() staffUserId!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}
export class WindowVersionDto {
  @IsInt() @Min(1) version!: number;
}
export class IssueLinkDto {
  @IsOptional() @IsUUID() sourceRoomId?: string;
  @IsUUID() customerId!: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsUUID('4', { each: true }) branchIds!: string[];
  @IsOptional() @IsUUID() appointmentId?: string;
}

export class CopyDayDto {
  @IsUUID() branchId!: string;
  @IsString() @MaxLength(10) fromDay!: string;
  @IsString() @MaxLength(10) toDay!: string;
}
