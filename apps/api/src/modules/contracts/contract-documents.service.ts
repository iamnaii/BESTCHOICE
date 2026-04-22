import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { calculateAgeInYears } from '../../utils/date.util';
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

  async findByContract(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.contractDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contractDocument.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }

  /** Get document checklist status */
  async getDocumentChecklist(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { birthDate: true } },
        contractDocuments: { where: { isLatest: true, deletedAt: null }, select: { documentType: true } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const requiresGuardian = contract.customer?.birthDate
      ? (() => {
          const age = calculateAgeInYears(contract.customer.birthDate);
          return age >= 17 && age < 20;
        })()
      : false;

    // DOWN_PAYMENT_RECEIPT + PDPA_CONSENT เอาออกจาก required:
    // - PDPA_CONSENT ระบบ auto-generate หลังเซ็น e-signature ครบ
    // - DOWN_PAYMENT_RECEIPT ไม่ต้อง upload — เจ้าของบันทึกยอดดาวน์
    //   ผ่าน POS/ระบบอื่นแทน
    const required = [
      { type: 'SIGNED_CONTRACT', label: 'สัญญาผ่อนชำระ PDF (e-Signature ครบ)', autoGenerate: true },
      { type: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', autoGenerate: false },
      { type: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน (Selfie KYC)', autoGenerate: false },
      { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า + หน้าจอแสดง IMEI', autoGenerate: false },
    ];

    if (requiresGuardian) {
      required.push({ type: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)', autoGenerate: false });
    }

    const docTypes = new Set(contract.contractDocuments.map((d) => d.documentType));
    const checklist = required.map((r) => ({
      ...r,
      present: docTypes.has(r.type as ContractDocumentType),
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

    // WR-004: Validate actual file size (base64 encoding is ~33% larger than raw bytes)
    // The DTO @MaxLength(15_000_000) guards the base64 string length;
    // this checks the decoded binary size does not exceed 10MB.
    if (dto.fileUrl.startsWith('data:')) {
      const rawBase64 = dto.fileUrl.substring(dto.fileUrl.indexOf(',') + 1);
      const actualSize = Buffer.byteLength(rawBase64, 'base64');
      if (actualSize > 10 * 1024 * 1024) {
        throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');
      }
    }

    // Compute file hash from actual file content (base64 bytes) for integrity verification
    let fileHash: string;
    if (dto.fileUrl.startsWith('data:')) {
      const base64Data = dto.fileUrl.substring(dto.fileUrl.indexOf(',') + 1);
      const buffer = Buffer.from(base64Data, 'base64');
      fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    } else {
      // For external URLs, hash the URL + filename + size as a fingerprint
      fileHash = crypto.createHash('sha256')
        .update(`${dto.fileUrl}|${dto.fileName}|${dto.fileSize || 0}`)
        .digest('hex');
    }

    // Use transaction to ensure version control + audit log are atomic
    return this.prisma.$transaction(async (tx) => {
      // Version control: mark previous versions as not latest
      const existingLatest = await tx.contractDocument.findFirst({
        where: { contractId, documentType: dto.documentType as ContractDocumentType, isLatest: true, deletedAt: null },
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
          details: { fileName: dto.fileName, version, fileHash } as Prisma.InputJsonValue,
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
      where: { id: docId, contractId, deletedAt: null },
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

    return this.prisma.contractDocument.update({ where: { id: docId }, data: { deletedAt: new Date() } });
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
