import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { SignerType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocumentPersistenceService } from './document-persistence.service';
import * as crypto from 'crypto';

/**
 * ContractSignatureService — e-signature lifecycle (พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์
 * พ.ศ. 2544): signContract / deleteSignature / getSignatures. Extracted VERBATIM
 * from DocumentsService.
 *
 * The all-4-signed → ensureSignedContractDocument hook is intentionally
 * fire-and-forget (non-awaited, .catch-wrapped, no transaction): puppeteer can take
 * seconds and must NOT block the signing response or roll back the signature on PDF
 * failure. DocumentPersistenceService is resolved through a late-bound accessor
 * supplied by the facade (matching the contract-cancellation late-bind pattern) so
 * the cross-seam call wires cleanly without a construction-order dependency.
 */
@Injectable()
export class ContractSignatureService {
  private readonly logger = new Logger(ContractSignatureService.name);

  constructor(
    private prisma: PrismaService,
    private getPersistence: () => DocumentPersistenceService,
  ) {}

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
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { where: { deletedAt: null } }, product: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Allow signing during CREATING, REJECTED, PENDING_REVIEW, and APPROVED (not after activation)
    const allowedWorkflow = ['CREATING', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'];
    if (!allowedWorkflow.includes(contract.workflowStatus)) {
      throw new BadRequestException('ไม่สามารถลงนามได้ในสถานะปัจจุบัน');
    }

    // Normalize STAFF to COMPANY for backward compatibility
    const normalizedType = signerType === 'STAFF' ? 'COMPANY' : signerType;

    // Check if already signed by this signer type
    const existing = contract.signatures.find((s) => {
      const existingNormalized = s.signerType === 'STAFF' ? 'COMPANY' : s.signerType;
      return existingNormalized === normalizedType;
    });
    if (existing) throw new BadRequestException(`${signerType} ลงนามไปแล้ว กรุณาเซ็นใหม่โดยลบลายเซ็นเดิมก่อน`);

    // Generate SHA-256 hash of contract content at signing time (พิสูจน์ว่าเอกสารไม่ถูกแก้ไขหลังเซ็น)
    const contractContent = JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
      imei: contract.product?.imeiSerial,
    });
    const contractHash = crypto.createHash('sha256').update(contractContent).digest('hex');

    const signature = await this.prisma.signature.create({
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

    // After all 4 required signatures are present, auto-generate the signed
    // contract PDF and save it as a ContractDocument (SIGNED_CONTRACT).
    // This satisfies the reviewer checklist without the user having to
    // manually upload a signed PDF — the system already has everything it
    // needs to produce one deterministically.
    const REQUIRED: Array<'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2'> = [
      'CUSTOMER',
      'COMPANY',
      'WITNESS_1',
      'WITNESS_2',
    ];
    const allSignerTypes = new Set<string>([
      ...contract.signatures.map((s) => (s.signerType === 'STAFF' ? 'COMPANY' : s.signerType)),
      normalizedType,
    ]);
    const allSigned = REQUIRED.every((t) => allSignerTypes.has(t));
    if (allSigned) {
      // Fire-and-forget — don't block the signing response on PDF generation
      // (puppeteer can take a few seconds). A salesperson fallback handles
      // the CUSTOMER-signs-via-LIFF case where staffUserId is null.
      const uploaderId = options?.staffUserId || contract.salespersonId;
      this.getPersistence().ensureSignedContractDocument(contractId, uploaderId).catch((err) =>
        this.logger.error(
          `Auto-save SIGNED_CONTRACT for ${contractId} failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }

    return signature;
  }

  // ─── Delete Signature (ลบลายเซ็นเพื่อเซ็นใหม่, เฉพาะก่อน ACTIVE) ───
  async deleteSignature(contractId: string, signerType: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { where: { deletedAt: null } } },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException('ไม่สามารถลบลายเซ็นหลังจากสัญญา ACTIVE แล้ว');
    }

    const sig = contract.signatures.find((s) => s.signerType === signerType);
    if (!sig) throw new NotFoundException('ไม่พบลายเซ็นที่ต้องการลบ');

    await this.prisma.signature.update({
      where: { id: sig.id },
      data: { deletedAt: new Date() },
    });
    return { message: `ลบลายเซ็น ${signerType} สำเร็จ` };
  }

  async getSignatures(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.signature.findMany({
        where,
        orderBy: { signedAt: 'asc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.signature.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }
}
