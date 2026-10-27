import { Prisma, Signature, SignatureCaptureIdentity } from '@prisma/client';
import { signatureDigest, signatureEvidenceRevision } from './signature-capture';
import { signatureDenied } from '../../employee-access/access-signatures-boundaries';
export type SignatureEvidence = Pick<
  Signature,
  | 'id'
  | 'contractId'
  | 'deletedAt'
  | 'signerType'
  | 'signatureImage'
  | 'signerName'
  | 'staffUserId'
  | 'contractHash'
  | 'signedAt'
>;
export async function verifiedSignatureIdentities(
  tx: Prisma.TransactionClient,
  parent: { id: string; customerId: string; branchId: string },
  rows: SignatureEvidence[],
  expected?: { contractHash: string; productIds: string[] },
) {
  const identities: SignatureCaptureIdentity[] = [];
  for (const row of rows) {
    const identity = await tx.signatureCaptureIdentity.findUnique({
      where: { signatureId: row.id },
    });
    if (!identity) return null;
    if (
      row.contractId !== parent.id ||
      row.deletedAt ||
      identity.contractId !== parent.id ||
      identity.customerId !== parent.customerId ||
      identity.branchId !== parent.branchId ||
      row.staffUserId !== identity.capturedById ||
      row.contractHash !== identity.contractHash ||
      signatureEvidenceRevision(row) !== identity.evidenceRevision
    )
      throw signatureDenied();
    const canonical = Buffer.from(row.signatureImage.split(',')[1] ?? '', 'base64');
    const submitted = Buffer.from(identity.originalDataUrl.split(',')[1] ?? '', 'base64');
    if (
      canonical.length !== identity.canonicalSize ||
      signatureDigest(canonical) !== identity.canonicalHash ||
      submitted.length !== identity.submittedSize ||
      signatureDigest(submitted) !== identity.submittedHash
    )
      throw signatureDenied();
    if (
      expected &&
      (identity.contractHash !== expected.contractHash ||
        JSON.stringify([...identity.productIds].sort()) !==
          JSON.stringify([...expected.productIds].sort()))
    )
      return null;
    identities.push(identity);
  }
  return identities;
}
