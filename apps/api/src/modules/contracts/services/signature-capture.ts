import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { SignContractDto } from '../dto/document.dto';
import { documentSourceRevision } from './document-source.util';
import { namedSignatureHash } from '../../promotions/contract-promotion-terms';
export const signatureDigest = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');
export const normalizedSigner = (type: string) => (type === 'STAFF' ? 'COMPANY' : type);
export async function normalizeSignature(dto: SignContractDto) {
  const invalid = () => new BadRequestException('ข้อมูลลายเซ็นไม่ถูกต้อง');
  if (
    typeof dto.signatureImage !== 'string' ||
    dto.signatureImage.length > 500000 ||
    dto.signatureSvg !== undefined
  )
    throw invalid();
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dto.signatureImage,
  );
  if (!match) throw invalid();
  const original = Buffer.from(match[2], 'base64');
  if (!original.length || original.length > 375000 || original.toString('base64') !== match[2])
    throw invalid();
  if (
    dto.signerName !== undefined &&
    (typeof dto.signerName !== 'string' ||
      dto.signerName.length > 200 ||
      [...dto.signerName].some(
        (char) =>
          char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
      ))
  )
    throw invalid();
  if (
    dto.screenSize !== undefined &&
    (typeof dto.screenSize !== 'string' ||
      dto.screenSize.length > 11 ||
      !/^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(dto.screenSize))
  )
    throw invalid();
  if ((dto.gpsLatitude !== undefined) !== (dto.gpsLongitude !== undefined)) throw invalid();
  if (
    dto.gpsLatitude !== undefined &&
    (typeof dto.gpsLatitude !== 'number' ||
      !Number.isFinite(dto.gpsLatitude) ||
      Math.abs(dto.gpsLatitude) > 90 ||
      typeof dto.gpsLongitude !== 'number' ||
      !Number.isFinite(dto.gpsLongitude) ||
      Math.abs(dto.gpsLongitude) > 180)
  )
    throw invalid();
  try {
    const decoder = sharp(original, {
      limitInputPixels: 4000000,
      failOn: 'warning',
      animated: true,
    });
    const meta = await decoder.metadata();
    if (
      meta.format !== match[1] ||
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      meta.width * meta.height > 4000000 ||
      (meta.pages ?? 1) !== 1
    )
      throw invalid();
    const canonical = await decoder.png().toBuffer();
    const dataUrl = `data:image/png;base64,${canonical.toString('base64')}`;
    if (canonical.length > 375000 || dataUrl.length > 500000) throw invalid();
    return {
      dataUrl,
      original: dto.signatureImage,
      submittedHash: signatureDigest(original),
      submittedSize: original.length,
      canonicalHash: signatureDigest(canonical),
      canonicalSize: canonical.length,
    };
  } catch {
    throw invalid();
  }
}
export function signatureEvidenceRevision(row: {
  signerType: string;
  signatureImage: string;
  signerName: string | null;
  staffUserId: string | null;
  contractHash: string | null;
  signedAt: Date;
}) {
  return documentSourceRevision({
    signerType: row.signerType,
    signatureImage: row.signatureImage,
    signerName: row.signerName,
    staffUserId: row.staffUserId,
    contractHash: row.contractHash,
    signedAt: row.signedAt,
  });
}
// Same canonical financial hash as the existing lifecycle; never a viewer projection.
export function canonicalSignatureHash(
  contract: Parameters<typeof namedSignatureHash>[0] & {
    product?: { imeiSerial: string | null } | null;
  },
) {
  if (contract.promotionFingerprint) return namedSignatureHash(contract);
  return signatureDigest(
    JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
      imei: contract.product?.imeiSerial,
      ...(contract.tradeInCreditSnapshot
        ? { tradeInCreditSnapshot: contract.tradeInCreditSnapshot }
        : {}),
    }),
  );
}
