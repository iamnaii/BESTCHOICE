import { IsString, IsUUID } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  productId!: string;

  @IsString()
  sessionId!: string;
}
