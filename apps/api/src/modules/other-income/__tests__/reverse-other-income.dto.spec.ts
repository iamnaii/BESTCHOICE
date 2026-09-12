import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OtherIncomeReverseReason } from '@prisma/client';
import { ReverseOtherIncomeDto } from '../dto/reverse-other-income.dto';

/**
 * DOC-05 (#1564) — the `reason` error message used to advertise
 * CANCELED_BY_CUSTOMER, a value the validator rejects (the enum has
 * CUSTOMER_REQUEST), and omitted WRONG_ACCOUNT / WRONG_AMOUNT. The message
 * must list exactly the values the API accepts.
 */
describe('ReverseOtherIncomeDto — reason message', () => {
  const messagesFor = async (reason: string) => {
    const errors = await validate(plainToInstance(ReverseOtherIncomeDto, { reason, note: 'บันทึกผิด ทดสอบระบบ' }));
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  };

  it('accepts every enum value', async () => {
    for (const reason of Object.values(OtherIncomeReverseReason)) expect(await messagesFor(reason)).toEqual([]);
  });

  it('names only real enum values when it rejects an unknown reason', async () => {
    const [message] = await messagesFor('CANCELED_BY_CUSTOMER');
    expect(message).toContain('reason ไม่ถูกต้อง');
    for (const reason of Object.values(OtherIncomeReverseReason)) expect(message).toContain(reason);
    expect(message).not.toContain('CANCELED_BY_CUSTOMER');
  });
});
