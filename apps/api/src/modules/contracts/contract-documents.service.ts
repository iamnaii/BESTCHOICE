import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { calculateAgeInYears } from '../../utils/date.util';
import * as crypto from 'crypto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { StorageService } from '../storage/storage.service';
import { Readable } from 'stream';
import { matchesDocumentMime } from './services/document-mime.util';

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
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  async getContent(contractId: string, docId: string) {
    const doc = await this.prisma.contractDocument.findFirst({ where: { id: docId, contractId, deletedAt: null } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    const inline = /^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/.exec(doc.fileUrl);
    if (inline) return { stream: Readable.from([Buffer.from(inline[2], 'base64')]), filename: doc.fileName, contentType: inline[1] };
    // Private object keys only. Never fetch a user-supplied external URL.
    if (/^[a-zA-Z0-9][^:?#]*\.(pdf|png|jpe?g|gif|webp)$/i.test(doc.fileUrl) && !doc.fileUrl.split('/').includes('..') && this.storage.configured) {
      const ext = doc.fileUrl.split('.').pop()!.toLowerCase();
      const contentType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return { stream: await this.storage.getStream(doc.fileUrl), filename: doc.fileName, contentType };
    }
    throw new BadRequestException('เปิดไฟล์นี้ไม่ได้ กรุณาตรวจสอบไฟล์แนบกับผู้ดูแลระบบ');
  }

  async assertContractAccess(contractId: string, actor: { role?: string; branchId?: string | null } | undefined, docId?: string) {
    if (!actor?.role) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { branchId: true, deletedAt: true } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== contract.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารของสาขานี้');
    }
    if (docId && !await this.prisma.contractDocument.findFirst({ where: { id: docId, contractId, deletedAt: null }, select: { id: true } })) {
      throw new NotFoundException('ไม่พบเอกสารของสัญญานี้');
    }
  }

  async assertGeneratedAccess(id: string, actor: { role?: string; branchId?: string | null } | undefined) {
    const document = await this.prisma.eDocument.findUnique({ where: { id, deletedAt: null }, select: { contractId: true } });
    if (!document) throw new NotFoundException('ไม่พบเอกสาร');
    await this.assertContractAccess(document.contractId, actor);
  }

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

    const data = /^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(dto.fileUrl);
    if (!data) throw new BadRequestException('รองรับไฟล์ JPG, PNG, GIF, WEBP หรือ PDF เท่านั้น');
    const bytes = Buffer.from(data[2], 'base64');
    if (!matchesDocumentMime(bytes, data[1])) throw new BadRequestException('เนื้อหาไฟล์ไม่ตรงกับประเภทที่ระบุ กรุณาเลือกไฟล์ใหม่');
    if (!bytes.length || bytes.toString('base64') !== data[2]) throw new BadRequestException('ข้อมูลไฟล์ไม่สมบูรณ์ กรุณาเลือกไฟล์ใหม่');
    if (bytes.length > 10 * 1024 * 1024) throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');
    const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');

    // Use transaction to ensure version control + audit log are atomic
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
      const currentContract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!currentContract || currentContract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
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
        ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'].includes(currentContract.status);

      const doc = await tx.contractDocument.create({
        data: {
          contractId,
          documentType: dto.documentType as ContractDocumentType,
          fileName: dto.fileName,
          originalName: dto.fileName,
          fileUrl: dto.fileUrl,
          fileSize: bytes.length,
          mimeType: data[1],
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
