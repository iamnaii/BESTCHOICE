import { BadRequestException } from '@nestjs/common';
import { Pkcs7Signer } from '../signer/pkcs7-signer';

describe('Pkcs7Signer (cert-pluggable contract)', () => {
  const signer = new Pkcs7Signer();

  it('rejects empty cert path with Thai error message', async () => {
    await expect(signer.sign('<xml/>', '', 'pass')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(signer.sign('<xml/>', '', 'pass')).rejects.toMatchObject({
      message: 'e-Tax cert ไม่ได้ตั้งค่า',
    });
  });

  it('rejects empty password with Thai error message', async () => {
    await expect(
      signer.sign('<xml/>', '/tmp/anything.p12', ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      signer.sign('<xml/>', '/tmp/anything.p12', ''),
    ).rejects.toMatchObject({
      message: 'e-Tax cert password ไม่ได้ตั้งค่า',
    });
  });

  it('surfaces file-not-found as Thai BadRequest (does not leak fs paths)', async () => {
    await expect(
      signer.sign('<xml/>', '/nonexistent/path/cert.p12', 'pass'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      signer.sign('<xml/>', '/nonexistent/path/cert.p12', 'pass'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('e-Tax'),
    });
  });
});
