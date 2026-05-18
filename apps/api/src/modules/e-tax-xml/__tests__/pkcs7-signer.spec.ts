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

  describe('C8 — embedInUblExtension', () => {
    // The sign() pipeline post-signature embeds the PKCS#7 bundle inside
    // <ext:ExtensionContent>; tests below cover the embed step directly so
    // we don't need a real PFX cert.

    it('replaces self-closing <ext:ExtensionContent/> with signed payload', () => {
      const xml =
        '<Invoice><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions><cbc:ID>1</cbc:ID></Invoice>';
      const out = signer.embedInUblExtension(xml, 'AAA-base64-XXX');

      expect(out).toContain('<ds:Signature');
      expect(out).toContain('xmlns:ds="http://www.w3.org/2000/09/xmldsig#"');
      expect(out).toContain('AAA-base64-XXX');
      // No more empty placeholder
      expect(out).not.toContain('<ext:ExtensionContent/>');
      // Outer Invoice still well-formed
      expect(out).toMatch(/<cbc:ID>1<\/cbc:ID>/);
    });

    it('replaces explicit empty <ext:ExtensionContent></ext:ExtensionContent>', () => {
      const xml =
        '<Invoice><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions></Invoice>';
      const out = signer.embedInUblExtension(xml, 'BBB-base64-YYY');

      expect(out).toContain('<ds:Signature');
      expect(out).toContain('BBB-base64-YYY');
      expect(out).not.toContain('<ext:ExtensionContent></ext:ExtensionContent>');
    });

    it('falls back to inserting before </Invoice> when placeholder is missing', () => {
      const xml = '<Invoice><cbc:ID>X</cbc:ID></Invoice>';
      const out = signer.embedInUblExtension(xml, 'CCC-base64-ZZZ');

      expect(out).toContain('<ds:Signature');
      expect(out).toContain('<ext:UBLExtensions');
      expect(out).toContain('CCC-base64-ZZZ');
      expect(out).toMatch(/<\/Invoice>$/);
    });
  });
});
