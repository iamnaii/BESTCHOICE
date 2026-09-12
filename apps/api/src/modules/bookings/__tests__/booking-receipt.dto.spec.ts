import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PayDepositDto } from '../dto/pay-deposit.dto';
import { ConvertBookingDto } from '../dto/convert-booking.dto';

describe('Booking receipt request validation', () => {
  it.each(['CASH', 'BANK_TRANSFER', 'QR_EWALLET'])('accepts an actual SHOP receipt via %s without a client account code', depositMethod => {
    expect(validateSync(plainToInstance(PayDepositDto, { depositMethod }))).toHaveLength(0);
  });
  it.each(['CREDIT_BALANCE', 'ONLINE_GATEWAY', 'unknown'])('does not accept %s as a receipt without an implemented collection flow', method => {
    expect(validateSync(plainToInstance(PayDepositDto, { depositMethod: method })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ConvertBookingDto, { paymentMethod: method })).length).toBeGreaterThan(0);
  });
  it('requires real boolean acknowledgements', () => {
    expect(validateSync(plainToInstance(ConvertBookingDto, { collectBalance: 'true', previouslyDamagedAcknowledged: 'false' }))).toHaveLength(2);
  });
});
