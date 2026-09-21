import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RejectDeviceReturnDto } from './reject-device-return.dto';

describe('RejectDeviceReturnDto runtime validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const validate = (reason: unknown) =>
    pipe.transform({ reason }, { type: 'body', metatype: RejectDeviceReturnDto });

  it.each(['          ', '   abc    ', 'x'.repeat(501)])(
    'rejects an invalid trimmed reason: %s',
    async (reason) => {
      await expect(validate(reason)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([10, 500])('accepts and normalizes a reason of length %i', async (length) => {
    const reason = 'x'.repeat(length);
    await expect(validate(`  ${reason}  `)).resolves.toMatchObject({ reason });
  });
});
