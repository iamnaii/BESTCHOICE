import { IsInt, Min, IsUUID } from 'class-validator';

export class ApplyLoyaltyDto {
  @IsUUID() reservationId!: string;
  @IsInt() @Min(1) points!: number;
}
