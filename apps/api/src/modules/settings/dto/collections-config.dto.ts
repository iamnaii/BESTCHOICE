import { IsInt, Max, Min } from 'class-validator';

export class CollectionsConfigDto {
  @IsInt({ message: 'dailyCap ต้องเป็นจำนวนเต็ม' })
  @Min(5, { message: 'dailyCap ต้องไม่น้อยกว่า 5' })
  @Max(200, { message: 'dailyCap ต้องไม่เกิน 200' })
  dailyCap: number;

  @IsInt({ message: 'workloadFloor ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'workloadFloor ต้องไม่น้อยกว่า 0' })
  @Max(100, { message: 'workloadFloor ต้องไม่เกิน 100' })
  workloadFloor: number;

  @IsInt({ message: 'etaPerContractMin ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'etaPerContractMin ต้องไม่น้อยกว่า 1' })
  @Max(60, { message: 'etaPerContractMin ต้องไม่เกิน 60' })
  etaPerContractMin: number;

  @IsInt({ message: 'sessionTargetMin ต้องเป็นจำนวนเต็ม' })
  @Min(30, { message: 'sessionTargetMin ต้องไม่น้อยกว่า 30' })
  @Max(480, { message: 'sessionTargetMin ต้องไม่เกิน 480' })
  sessionTargetMin: number;

  @IsInt({ message: 'selfClaimLockHours ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'selfClaimLockHours ต้องไม่น้อยกว่า 1' })
  @Max(24, { message: 'selfClaimLockHours ต้องไม่เกิน 24' })
  selfClaimLockHours: number;
}
