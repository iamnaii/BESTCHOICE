import { IsInt, IsUUID, Min } from 'class-validator';

export class TransferDto {
  @IsUUID()
  fromCollectorId: string;

  @IsUUID()
  toCollectorId: string;

  @IsInt()
  @Min(1)
  count: number;
}
