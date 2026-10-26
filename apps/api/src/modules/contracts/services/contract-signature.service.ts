import { currentSignatureAuthority, signatureDenied } from '../../employee-access/access-signatures-boundaries';
import { domainAccessClient } from '../../employee-access/access-execution-context';
import { assertNamedPreparation, namedExecution } from '../../promotions/contract-promotion-source';
import { assertContractPromotionTerms } from '../../promotions/contract-promotion-terms';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SignerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { canonicalSignatureHash } from './signature-capture';

/** Canonical lifecycle only. The staff capture boundary owns authorization,
 * immutable evidence and outer-commit production; this facade never impersonates
 * a salesperson or starts an unowned render effect. */
@Injectable()
export class ContractSignatureService {

  constructor(
    private basePrisma: PrismaService,
  ) {}

  private get prisma() { return domainAccessClient(this.basePrisma); }

  // ─── E-Signature (พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) ────
  async signContract(
    contractId: string,
    signatureImage: string,
    signerType: string,
    req: { ip?: string; userAgent?: string },
    options?: {
      signatureSvg?: string;
      signerName?: string;
      screenSize?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
      staffUserId?: string;
    },
  ) {
    const authority = currentSignatureAuthority('signContract');
    if (authority.parent.id !== contractId || options?.staffUserId !== authority.actorId) throw signatureDenied();
    const { signature } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: {
          signatures: { where: { deletedAt: null }, select: { id: true, signerType: true } },
          product: true,
          customer: { select: { birthDate: true } },
        },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (contract.promotionFingerprint) {
        const ctx = namedExecution();
        if (!options?.staffUserId || options.staffUserId !== ctx.snapshot.userId) throw new ForbiddenException('ผู้บันทึกลายเซ็นไม่ตรงกับผู้ดำเนินการปัจจุบัน');
        await assertNamedPreparation(contract, options.staffUserId);
        await assertContractPromotionTerms(contract);
      }

      // Allow signing during CREATING, REJECTED, PENDING_REVIEW, and APPROVED (not after activation)
      const allowedWorkflow = ['CREATING', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'];
      if (contract.status !== 'DRAFT' || !allowedWorkflow.includes(contract.workflowStatus)) {
        throw new BadRequestException('ไม่สามารถลงนามได้ในสถานะปัจจุบัน');
      }

      // Normalize STAFF to COMPANY for backward compatibility
      const normalizedType = signerType === 'STAFF' ? 'COMPANY' : signerType;

      // Check if already signed by this signer type
      const existing = contract.signatures.find((s) => {
        const existingNormalized = s.signerType === 'STAFF' ? 'COMPANY' : s.signerType;
        return existingNormalized === normalizedType;
      });
      if (existing)
        throw new BadRequestException(
          `${signerType} ลงนามไปแล้ว กรุณาเซ็นใหม่โดยลบลายเซ็นเดิมก่อน`,
        );

      // Generate SHA-256 hash of contract content at signing time (พิสูจน์ว่าเอกสารไม่ถูกแก้ไขหลังเซ็น)
      const contractHash = canonicalSignatureHash(contract);

      const signature = await tx.signature.create({
        data: {
          contractId,
          signerType: signerType as SignerType,
          signatureImage,
          signatureSvg: options?.signatureSvg || null,
          signerName: options?.signerName || null,
          ipAddress: req.ip || null,
          deviceInfo: req.userAgent || null,
          screenSize: options?.screenSize || null,
          gpsLatitude: options?.gpsLatitude ?? null,
          gpsLongitude: options?.gpsLongitude ?? null,
          staffUserId: options?.staffUserId || null,
          contractHash,
        },
      });

      return { contract, signature };
    });

    return signature;
  }

  // ─── Delete Signature (ลบลายเซ็นเพื่อเซ็นใหม่, เฉพาะก่อน ACTIVE) ───
  async deleteSignature(contractId: string, signerType: string) {
    const authority = currentSignatureAuthority('deleteSignature');
    if (authority.parent.id !== contractId) throw signatureDenied();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { signatures: { where: { deletedAt: null }, select: { id: true, signerType: true } } },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (contract.promotionFingerprint) {
        await assertNamedPreparation(contract);
        await assertContractPromotionTerms(contract);
      }

      if (contract.status !== 'DRAFT') {
        throw new BadRequestException('ไม่สามารถลบลายเซ็นหลังจากสัญญา ACTIVE แล้ว');
      }

      const normalize = (type: string) => (type === 'STAFF' ? 'COMPANY' : type);
      const sig = contract.signatures.find(
        (s) => normalize(s.signerType) === normalize(signerType),
      );
      if (!sig) throw new NotFoundException('ไม่พบลายเซ็นที่ต้องการลบ');

      const deletedAt = new Date();
      await tx.signature.update({
        where: { id: sig.id },
        data: { deletedAt },
      });
      // Keep old rows/files as history; remove superseded signed evidence from
      // current lists and checklists in the same transaction as signature removal.
      await tx.eDocument.updateMany({
        where: { contractId, deletedAt: null, documentType: { in: ['CONTRACT', 'PDPA_CONSENT'] } },
        data: { deletedAt },
      });
      await tx.contractDocument.updateMany({
        where: {
          contractId,
          deletedAt: null,
          isLatest: true,
          documentType: { in: ['SIGNED_CONTRACT', 'PDPA_CONSENT'] },
        },
        data: { isLatest: false, deletedAt },
      });
      await tx.notificationLog.updateMany({
        where: {
          relatedId: contractId,
          subject: 'CONTRACT_DOCUMENTS_READY',
          deletedAt: null,
          status: { in: ['PENDING', 'DELAYED', 'RETRY_PENDING', 'FAILED'] },
        },
        data: { status: 'CANCELLED', nextRetryAt: null },
      });
      return { message: `ลบลายเซ็น ${signerType} สำเร็จ` };
    });
  }

}
