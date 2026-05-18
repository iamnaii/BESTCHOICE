import { BadRequestException, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as forge from 'node-forge';

/**
 * PKCS#7 detached-signature wrapper for e-Tax Invoice XML.
 *
 * Per ขมธอ.21-2562 the signature must be:
 *   - A PKCS#7/CMS bundle (base64-encoded)
 *   - Detached — does NOT include the original payload
 *   - SHA-256 digest, RSA signing
 *   - Cert chain attached so RD can verify against approved CA (NDID,
 *     ThaiCERT, INET)
 *
 * Cert + password come from env (or encrypted SystemConfig via the
 * `e-tax` integration in IntegrationConfigService — service layer
 * decrypts before calling here):
 *   - ETAX_CERT_PATH — absolute path to .p12/.pfx file
 *   - ETAX_CERT_PASSWORD — passphrase
 *
 * If either is missing this throws BadRequestException — the service
 * layer surfaces "e-Tax cert ไม่ได้ตั้งค่า" to the UI.
 */
export class Pkcs7Signer {
  private readonly logger = new Logger(Pkcs7Signer.name);

  /**
   * Load a PFX/P12 file from disk and return its cert + key.
   * @internal — exposed for tests; production code should use sign().
   */
  async loadPfx(
    certPath: string,
    password: string,
  ): Promise<{ cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }> {
    if (!certPath) {
      throw new BadRequestException('e-Tax cert ไม่ได้ตั้งค่า');
    }
    if (!password) {
      throw new BadRequestException('e-Tax cert password ไม่ได้ตั้งค่า');
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(certPath);
    } catch (err) {
      // Don't leak the raw filesystem error to the UI
      this.logger.error(
        `Failed to read e-Tax cert file at ${certPath}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'ไม่สามารถอ่านไฟล์ใบรับรอง e-Tax — ตรวจสอบ path + permissions',
      );
    }

    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(buf.toString('binary')));
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt e-Tax PFX (wrong password?): ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'ปลดล็อกใบรับรอง e-Tax ไม่ได้ — password ไม่ถูกต้อง',
      );
    }

    // Locate first cert bag + first key bag.
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag?.cert) {
      throw new BadRequestException('ไม่พบใบรับรองใน PFX file');
    }

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    if (!keyBag?.key) {
      throw new BadRequestException('ไม่พบ private key ใน PFX file');
    }

    return {
      cert: certBag.cert,
      key: keyBag.key as forge.pki.rsa.PrivateKey,
    };
  }

  /**
   * Sign the given XML and return a PKCS#7 detached signature bundle
   * (base64-encoded). Caller stores in `ETaxSubmission.signedXml`.
   *
   * @param xml         XML body to sign (will be UTF-8 encoded before signing)
   * @param certPath    Absolute path to PFX/P12 file
   * @param certPass    PFX passphrase
   * @returns           Base64 PKCS#7 envelope
   */
  async sign(xml: string, certPath: string, certPass: string): Promise<string> {
    const { cert, key } = await this.loadPfx(certPath, certPass);

    // Build CMS/PKCS#7 SignedData
    const p7 = forge.pkcs7.createSignedData();
    // node-forge accepts UTF-8 text + treats it as binary content; e-Tax
    // spec needs original XML bytes in detached mode so we attach the UTF-8
    // representation here (will be detached via the `detached: true` flag).
    p7.content = forge.util.createBuffer(xml, 'utf8');
    p7.addCertificate(cert);
    p7.addSigner({
      key,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
      ],
    });

    p7.sign({ detached: true });

    // Serialize to DER then base64 — what RD expects in the
    // ext:UBLExtensions slot.
    const derAsn1 = p7.toAsn1();
    const derBytes = forge.asn1.toDer(derAsn1).getBytes();
    return forge.util.encode64(derBytes);
  }
}
