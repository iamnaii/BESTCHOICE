import { IsOptional, IsDateString } from 'class-validator';

export class ReturnToCustomerDto {
  @IsOptional()
  @IsDateString()
  returnedToCustomerAt?: string;
}
