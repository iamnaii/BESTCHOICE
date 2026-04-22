import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class ValidatePromoDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsUUID() reservationId!: string;
}
