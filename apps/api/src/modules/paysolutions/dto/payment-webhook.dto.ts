import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class PaymentWebhookDto {
  @IsNotEmpty()
  @IsString()
  refno: string; // Pay Solutions reference number

  @IsNotEmpty()
  @IsString()
  merchantid: string;

  @IsNotEmpty()
  @IsString()
  customeremail: string;

  @IsNotEmpty()
  @IsString()
  productdetail: string;

  @IsNotEmpty()
  @IsString()
  total: string; // Amount as string from Pay Solutions

  @IsOptional()
  @IsString()
  status?: string; // Payment status from gateway

  @IsOptional()
  @IsString()
  result_code?: string; // Result code (00 = success)

  @IsOptional()
  @IsString()
  card_no?: string;

  @IsOptional()
  @IsString()
  card_type?: string;

  @IsOptional()
  @IsString()
  order_no?: string; // Our internal order/payment ID

  @IsOptional()
  @IsString()
  transaction_id?: string;
}
