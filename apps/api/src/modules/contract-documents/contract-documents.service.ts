import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractDocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import * as crypto from 'crypto';

const VALID_DOCUMENT_TYPES = [
  'SIGNED_CONTRACT',
  'ID_CARD_COPY',
  'ID_CARD_BACK',
  'KYC_SELFIE',
  'DEVICE_PHOTO',
  'DEVICE_IMEI_PHOTO',
  'DOWN_PAYMENT_RECEIPT',
  'PDPA_CONSENT',
  'GUARDIAN_DOC',
  'PAYMENT_SCHEDULE',
  'PAYMENT_RECEIPT',
  'ADDENDUM',
  'FACEBOOK_PROFILE',
  'FACEBOOK_POST',
  'LINE_PROFILE',
  'DEVICE_RECEIPT_PHOTO',
  'BANK_STATEMENT',
  'KYC',
  'OTHER',
];

// Document types that become immutable once signed contract is active
const IMMUTABLE_DOC_TYPES = ['SIGNED_CONTRACT', 'PDPA_CONSENT', 'PAYMENT_RECEIPT'];

@Injectable()
export class ContractDocumentsService {
  constructor(private prisma: PrismaService) {}

  async findByContract(contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.contractDocument.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  /** Get document checklist status */
  async getDocumentChecklist(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { birthDate: true } },
        contractDocuments: { where: { isLatest: true }, select: { documentType: true } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const requiresGuardian = contract.customer?.birthDate
      ? (() => {
          const age = Math.floor((Date.now() - new Date(contract.customer.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          return age >= 17 && age < 20;
        })()
      : false;

    const required = [
      { type: 'SIGNED_CONTRACT', label: 'สัญญาผ่อนชำระ PDF (e-Signature ครบ)', autoGenerate: true },
      { type: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', autoGenerate: false },
      { type: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน (Selfie KYC)', autoGenerate: false },
      { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า + หน้าจอแสดง IMEI', autoGenerate: false },
      { type: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานการชำระเงินดาวน์', autoGenerate: false },
      { type: 'PDPA_CONSENT', label: 'Consent PDPA ที่ลูกค้ายินยอม', autoGenerate: true },
    ];

    if (requiresGuardian) {
      required.push({ type: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)', autoGenerate: false });
    }

    const docTypes = new Set(contract.contractDocuments.map((d) => d.documentType));
    const checklist = required.map((r) => ({
      ...r,
      present: docTypes.has(r.type as any),
    }));

    return {
      complete: checklist.every((c) => c.present),
      checklist,
      requiresGuardian,
    };
  }

  /** Upload with versioning and hash */
  async upload(contractId: string, dto: UploadContractDocumentDto, userId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    if (!VALID_DOCUMENT_TYPES.includes(dto.documentType)) {
      throw new BadRequestException(`ประเภทเอกสารไม่ถูกต้อง: ${dto.documentType}`);
    }

    // Compute file hash from actual content when available
    const hashInput = dto.fileUrl.startsWith('data:')
      ? dto.fileUrl.substring(dto.fileUrl.indexOf(',') + 1)
      : dto.fileUrl + dto.fileName;
    const fileHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // Use transaction to ensure version control + audit log are atomic
    return this.prisma.$transaction(async (tx) => {
      // Version control: mark previous versions as not latest
      const existingLatest = await tx.contractDocument.findFirst({
        where: { contractId, documentType: dto.documentType as any, isLatest: true },
      });

      let version = 1;
      if (existingLatest) {
        // Check if existing doc is immutable
        if (existingLatest.isImmutable) {
          throw new BadRequestException(
            `เอกสารประเภท ${dto.documentType} เป็นเอกสารถาวร ไม่สามารถ upload ทับได้`
          );
        }

        version = existingLatest.version + 1;
        await tx.contractDocument.update({
          where: { id: existingLatest.id },
          data: { isLatest: false },
        });
      }

      // Determine if this document should be immutable
      const isImmutable = IMMUTABLE_DOC_TYPES.includes(dto.documentType) &&
        ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'].includes(contract.status);

      const doc = await tx.contractDocument.create({
        data: {
          contractId,
          documentType: dto.documentType as ContractDocumentType,
          fileName: dto.fileName,
          originalName: dto.fileName,
          fileUrl: dto.fileUrl,
          fileSize: dto.fileSize,
          mimeType: dto.mimeType,
          fileHash,
          version,
          isLatest: true,
          isImmutable,
          notes: dto.notes,
          uploadedById: userId,
        },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      });

      // Log document upload
      await tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          contractId,
          action: 'UPLOAD',
          userId,
          details: { fileName: dto.fileName, version, fileHash } as any,
        },
      });

      return doc;
    });
  }

  /** Record document view in audit log */
  async recordView(contractId: string, docId: string, userId: string, req?: { ip?: string; userAgent?: string }) {
    await this.prisma.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: 'VIEW',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.userAgent,
      },
    });
  }

  /** Record document download in audit log */
  async recordDownload(contractId: string, docId: string, userId: string, req?: { ip?: string; userAgent?: string }) {
    await this.prisma.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: 'DOWNLOAD',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.userAgent,
      },
    });
  }

  async remove(contractId: string, docId: string, userId: string, userRole: string) {
    const doc = await this.prisma.contractDocument.findFirst({
      where: { id: docId, contractId },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    // Check immutability
    if (doc.isImmutable) {
      throw new ForbiddenException('เอกสารนี้เป็นเอกสารถาวร ห้ามลบเด็ดขาด');
    }

    // Check if contract is ACTIVE - prevent deletion of documents for active contracts
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (contract && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new ForbiddenException('ห้ามลบเอกสารของสัญญาที่ ACTIVE');
    }

    // Only OWNER and BRANCH_MANAGER can delete
    if (!['OWNER', 'BRANCH_MANAGER'].includes(userRole)) {
      throw new ForbiddenException('เฉพาะผู้จัดการหรือเจ้าของร้านเท่านั้นที่สามารถลบเอกสาร');
    }

    // Log deletion
    await this.prisma.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: 'DELETE',
        userId,
      },
    });

    return this.prisma.contractDocument.delete({ where: { id: docId } });
  }

  /** Get document audit trail */
  async getDocumentAuditTrail(contractId: string) {
    return this.prisma.documentAuditLog.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
