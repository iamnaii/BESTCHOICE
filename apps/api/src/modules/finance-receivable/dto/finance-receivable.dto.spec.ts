import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateFinanceReceivableDto } from './finance-receivable.dto';

/**
 * #D5 — commissionRate is a fraction (0..1); the service recomputes
 * commissionAmount = expectedAmount * rate and netExpectedAmount =
 * expectedAmount - commissionAmount. A rate > 1 yields a NEGATIVE
 * netExpectedAmount. Guard it at the DTO boundary.
 */
describe('UpdateFinanceReceivableDto.commissionRate bounds', () => {
  async function errorsFor(commissionRate: number) {
    const dto = plainToInstance(UpdateFinanceReceivableDto, { commissionRate });
    return validate(dto);
  }

  it('rejects rate > 1 (would make netExpectedAmount negative)', async () => {
    const errs = await errorsFor(1.5);
    expect(errs.some((e) => e.property === 'commissionRate' && e.constraints?.max)).toBe(true);
  });

  it('rejects a negative rate', async () => {
    const errs = await errorsFor(-0.1);
    expect(errs.some((e) => e.property === 'commissionRate' && e.constraints?.min)).toBe(true);
  });

  it('accepts a valid fraction (0, 0.1, 1)', async () => {
    expect(await errorsFor(0)).toHaveLength(0);
    expect(await errorsFor(0.1)).toHaveLength(0);
    expect(await errorsFor(1)).toHaveLength(0);
  });
});
