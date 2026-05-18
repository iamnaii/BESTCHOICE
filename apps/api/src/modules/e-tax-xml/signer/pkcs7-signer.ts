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
   * Sign the given XML and return a UBL-2.1-wrapped envelope that contains
   * the original XML body with `<ext:ExtensionContent>` populated by a
   * `<ds:Signature>` element wrapping the PKCS#7/CMS detached signature.
   *
   * Caller stores the returned envelope in `ETaxSubmission.signedXml`.
   *
   * Why the envelope (C8): the previous return value was just the raw
   * base64 CMS bundle — RD's submitInvoice endpoint requires the entire
   * UBL Invoice document with the signature embedded; submitting only the
   * detached signature without its payload would be rejected 100% of
   * the time. We now wrap the signature in a W3C-XML-Signature `ds:Signature`
   * shell (Object/Value carries the PKCS#7 bundle) inside the existing
   * `ext:ExtensionContent` slot the builder reserved.
   *
   * @param xml         XML body to sign (UTF-8 encoded before signing)
   * @param certPath    Absolute path to PFX/P12 file
   * @param certPass    PFX passphrase
   * @returns           Full signed UBL XML envelope (UTF-8 string)
   */
  async sign(xml: string, certPath: string, certPass: string): Promise<string> {
    const pkcs7Base64 = await this.signPkcs7Detached(xml, certPath, certPass);
    return this.embedInUblExtension(xml, pkcs7Base64);
  }

  /**
   * Build the bare PKCS#7/CMS detached signature in base64 — exposed
   * separately so tests + future XAdES-BES upgrades can reuse it without
   * the envelope wrapping step.
   */
  async signPkcs7Detached(
    xml: string,
    certPath: string,
    certPass: string,
  ): Promise<string> {
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

    // Serialize to DER then base64.
    const derAsn1 = p7.toAsn1();
    const derBytes = forge.asn1.toDer(derAsn1).getBytes();
    return forge.util.encode64(derBytes);
  }

  /**
   * Embed a base64 PKCS#7 bundle inside `<ext:ExtensionContent>` of the
   * UBL XML via a `<ds:Signature>` wrapper. Returns the full signed XML.
   *
   * The wrapping pattern (XAdES-BES "lite"):
   *   <ext:ExtensionContent>
   *     <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
   *       <ds:Object Id="PKCS7-CMS">
   *         <ds:SignatureValue>{base64 CMS bundle}</ds:SignatureValue>
   *       </ds:Object>
   *     </ds:Signature>
   *   </ext:ExtensionContent>
   *
   * This produces a non-empty extension payload that RD's submitInvoice
   * pre-check will not reject for "missing signature". Once the project
   * adopts full XAdES-BES (separate signed-info + key-info + canonicalized
   * payload), this method swaps to emit the proper `ds:SignedInfo` block.
   */
  embedInUblExtension(xml: string, pkcs7Base64: string): string {
    const signatureBlock = [
      '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
      '<ds:Object Id="PKCS7-CMS">',
      '<ds:SignatureValue>',
      pkcs7Base64,
      '</ds:SignatureValue>',
      '</ds:Object>',
      '</ds:Signature>',
    ].join('');

    // The builder emits an empty `<ext:ExtensionContent/>` (self-closing
    // when txt is ''); xmlbuilder2 sometimes writes the long form
    // `<ext:ExtensionContent></ext:ExtensionContent>`. Handle both.
    if (xml.includes('<ext:ExtensionContent/>')) {
      return xml.replace(
        '<ext:ExtensionContent/>',
        `<ext:ExtensionContent>${signatureBlock}</ext:ExtensionContent>`,
      );
    }
    if (xml.includes('<ext:ExtensionContent></ext:ExtensionContent>')) {
      return xml.replace(
        '<ext:ExtensionContent></ext:ExtensionContent>',
        `<ext:ExtensionContent>${signatureBlock}</ext:ExtensionContent>`,
      );
    }

    // Defensive: if the placeholder isn't there (XML built outside our
    // builder), fall back to inserting before the closing Invoice tag so
    // RD at least has the signature element to inspect.
    this.logger.warn(
      'ExtensionContent placeholder not found — appending signature before </Invoice>',
    );
    return xml.replace(
      '</Invoice>',
      `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent>${signatureBlock}</ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions></Invoice>`,
    );
  }
}
