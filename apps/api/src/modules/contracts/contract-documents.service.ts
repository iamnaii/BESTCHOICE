import { GeneratedDocumentsService } from './services/generated-documents.service';
import {
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ContractDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { calculateAgeInYears } from '../../utils/date.util';
import * as crypto from 'crypto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { StorageService } from '../storage/storage.service';
import { Readable } from 'stream';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import {
  UploadedDocumentOperation,
  uploadedDocumentRequest,
} from '../employee-access/access-contract-files-context';
import { VerifiedContractDocumentBuffer } from './services/verified-contract-document';
import {
  UploadedContractDocumentReference,
  UploadedContractDocumentList,
  UploadedContractDocumentHistory,
  UploadedContractDocumentActivity,
  UploadedContractDocumentChecklist,
} from '@installment/shared';
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
const IMMUTABLE_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'];

/** เอกสารที่ลบ/อัปโหลดทับไม่ได้ — กติกาเดียวกับตอนอัปโหลด (ตัวนำเข้าระบบเก่าใช้ตัวเดียวกัน) */
export function isImmutableContractDocument(documentType: string, contractStatus: string): boolean {
  return (
    IMMUTABLE_DOC_TYPES.includes(documentType) && IMMUTABLE_CONTRACT_STATUSES.includes(contractStatus)
  );
}
type LegacyDocumentStream = { stream: Readable; filename: string; contentType: string };

@Injectable()
export class ContractDocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @Optional() private generated?: GeneratedDocumentsService,
  ) {}
  private get db(): Prisma.TransactionClient {
    return (
      currentDomainAccess()?.client ??
      uploadedDocumentRequest.getStore()?.legacyClient ??
      this.prisma
    );
  }
  private get managed() {
    return !!currentDomainAccess()?.snapshot.managed;
  }
  private get proof() {
    return uploadedDocumentRequest.getStore()?.proof;
  }
  private assertOperation(
    operation: UploadedDocumentOperation,
    contractId: string,
    actorId?: string,
  ) {
    if (!this.managed) return;
    const request = uploadedDocumentRequest.getStore(),
      current = currentDomainAccess()!;
    if (
      !request ||
      request.operation !== operation ||
      request.proof?.contractId !== contractId ||
      request.actorId !== current.snapshot.userId ||
      (actorId !== undefined && actorId !== request.actorId) ||
      current.scopeReads ||
      current.isolationLevel !== 'Serializable'
    )
      throw new ForbiddenException('ต้องตรวจสิทธิ์เอกสารในธุรกรรมเดียวกัน');
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tx = currentDomainAccess()?.client ?? uploadedDocumentRequest.getStore()?.legacyClient;
    return tx ? work(tx) : this.prisma.$transaction(work);
  }
  /** Only content's explicit request adapter may obtain a managed release result. */
  async prepareContent(
    contractId: string,
    docId: string,
    userId: string,
    req?: { ip?: string; userAgent?: string },
  ): Promise<VerifiedContractDocumentBuffer | LegacyDocumentStream> {
    const request = uploadedDocumentRequest.getStore();
    if (request?.prepare && request.release && this.generated) {
      const staged = await request.prepare(() =>
        this.generated!.prepareUploadedAttachment(contractId, docId),
      );
      if (staged) {
        const bytes = await this.generated.acquireGeneratedBytes(staged);
        return request.release(() =>
          this.generated!.releaseUploadedAttachment(contractId, docId, staged, bytes),
        );
      }
    }
    if (request?.release)
      return request.release(async () => {
        if (!this.managed) {
          await this.recordView(contractId, docId, userId, req);
          return this.getContent(contractId, docId);
        }
        return this.verifiedContent(contractId, docId);
      });
    if (this.managed) throw new ForbiddenException('ต้องตรวจสิทธิ์ก่อนเปิดเอกสาร');
    await this.recordView(contractId, docId, userId, req);
    return this.getContent(contractId, docId);
  }
  private async verifiedContent(
    contractId: string,
    docId: string,
  ): Promise<VerifiedContractDocumentBuffer> {
    this.assertOperation('content', contractId);
    const proof = this.proof;
    if (!proof?.visible || proof.contractId !== contractId)
      throw new ForbiddenException('เปิดเอกสารนี้ไม่ได้');
    const doc = await this.db.contractDocument.findFirst({
      where: { id: docId, contractId, deletedAt: null },
      include: { uploadIdentity: true },
    });
    const identity = doc?.uploadIdentity;
    if (
      !doc ||
      !identity ||
      identity.contractId !== contractId ||
      identity.customerId !== proof.customerId ||
      identity.branchId !== proof.branchId ||
      doc.fileUrl.length > 15000000 ||
      doc.fileHash !== identity.fileHash ||
      doc.mimeType !== identity.mimeType ||
      doc.fileSize !== identity.fileSize ||
      crypto.createHash('sha256').update(doc.fileUrl).digest('hex') !== identity.inlineValueHash
    )
      throw new ForbiddenException('ไฟล์ยังไม่มีหลักฐานยืนยันที่ใช้เปิดได้');
    const data =
      /^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(
        doc.fileUrl,
      );
    if (
      !data ||
      data[1] !== identity.mimeType ||
      data[2].length > Math.ceil((10 * 1024 * 1024) / 3) * 4
    )
      throw new ForbiddenException('หลักฐานไฟล์ไม่ตรงกัน');
    const bytes = Buffer.from(data[2], 'base64');
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      bytes.length !== identity.fileSize ||
      bytes.toString('base64') !== data[2] ||
      !matchesDocumentMime(bytes, data[1]) ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== identity.fileHash
    )
      throw new ForbiddenException('หลักฐานไฟล์ไม่ตรงกัน');
    await this.db.documentAuditLog.create({
      data: {
        contractId,
        documentId: docId,
        userId: currentDomainAccess()!.snapshot.userId,
        action: 'CONTENT_RELEASE_AUTHORIZED',
      },
    });
    const extension =
      identity.mimeType === 'application/pdf' ? 'pdf' : identity.mimeType.split('/')[1];
    return {
      kind: 'verified-upload',
      source: {
        documentId: docId,
        contractId,
        customerId: proof.customerId,
        branchId: proof.branchId,
        currentCompany: proof.company,
        identityId: identity.id,
      },
      bytes,
      contentType: identity.mimeType as VerifiedContractDocumentBuffer['contentType'],
      filename: `document-${doc.version}.${extension}`,
    };
  }
  private async referencesVisible(contractId: string, includeDeleted = false): Promise<boolean> {
    if (!this.proof?.visible) return false;
    if (this.generated) return this.generated.uploadedReferencesVisible(contractId, includeDeleted);
    // Optional only for deployments/tests with uploaded-only documents. A missing
    // generated verifier must never silently authorize a linked reference.
    if (
      await this.db.generatedContractDocumentLink.count({
        where: { document: { contractId, ...(includeDeleted ? {} : { deletedAt: null }) } },
      })
    )
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
    return true;
  }
  private reference(doc: {
    id: string;
    documentType: string;
    version: number;
    isLatest: boolean;
    isImmutable: boolean;
    createdAt: Date;
    uploadIdentity?: { contractId: string; customerId: string; branchId: string } | null;
    generatedIdentityLink?: {
      identity: { contractId: string; customerId: string; branchId: string };
    } | null;
  }): UploadedContractDocumentReference {
    const proof = this.proof;
    const valid =
      doc.uploadIdentity &&
      proof &&
      doc.uploadIdentity.contractId === proof.contractId &&
      doc.uploadIdentity.customerId === proof.customerId &&
      doc.uploadIdentity.branchId === proof.branchId;
    return {
      id: doc.id,
      documentType: doc.documentType,
      version: doc.version,
      isLatest: doc.isLatest,
      isImmutable: doc.isImmutable,
      createdAt: doc.createdAt.toISOString(),
      contentStatus: valid
        ? 'VERIFIED_UPLOAD'
        : doc.generatedIdentityLink &&
            proof &&
            doc.generatedIdentityLink.identity.contractId === proof.contractId &&
            doc.generatedIdentityLink.identity.customerId === proof.customerId &&
            doc.generatedIdentityLink.identity.branchId === proof.branchId
          ? 'VERIFIED_GENERATED'
          : 'UNVERIFIED',
    };
  }
  private readonly referenceSelect = {
    id: true,
    documentType: true,
    version: true,
    isLatest: true,
    isImmutable: true,
    createdAt: true,
    uploadIdentity: { select: { contractId: true, customerId: true, branchId: true } },
    generatedIdentityLink: {
      select: { identity: { select: { contractId: true, customerId: true, branchId: true } } },
    },
  } as const;

  async getContent(contractId: string, docId: string): Promise<LegacyDocumentStream> {
    if (this.managed) throw new ForbiddenException('ต้องใช้ทางเปิดเอกสารที่ตรวจสอบแล้ว');
    const doc = await this.db.contractDocument.findFirst({
      where: { id: docId, contractId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    const inline =
      /^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/.exec(
        doc.fileUrl,
      );
    if (inline)
      return {
        stream: Readable.from([Buffer.from(inline[2], 'base64')]),
        filename: doc.fileName,
        contentType: inline[1],
      };
    // Private object keys only. Never fetch a user-supplied external URL.
    if (
      /^[a-zA-Z0-9][^:?#]*\.(pdf|png|jpe?g|gif|webp)$/i.test(doc.fileUrl) &&
      !doc.fileUrl.split('/').includes('..') &&
      this.storage.configured
    ) {
      const ext = doc.fileUrl.split('.').pop()!.toLowerCase();
      const contentType =
        ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return {
        stream: await this.storage.getStream(doc.fileUrl),
        filename: doc.fileName,
        contentType,
      };
    }
    throw new BadRequestException('เปิดไฟล์นี้ไม่ได้ กรุณาตรวจสอบไฟล์แนบกับผู้ดูแลระบบ');
  }

  async assertContractAccess(
    contractId: string,
    actor: { role?: string; branchId?: string | null } | undefined,
    docId?: string,
  ) {
    if (!actor?.role) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
    const contract = await this.db.contract.findUnique({
      where: { id: contractId },
      select: { branchId: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== contract.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารของสาขานี้');
    }
    if (
      docId &&
      !(await this.db.contractDocument.findFirst({
        where: { id: docId, contractId, deletedAt: null },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('ไม่พบเอกสารของสัญญานี้');
    }
  }

  async assertGeneratedAccess(
    id: string,
    actor: { role?: string; branchId?: string | null } | undefined,
  ) {
    const document = await this.db.eDocument.findUnique({
      where: { id, deletedAt: null },
      select: { contractId: true },
    });
    if (!document) throw new NotFoundException('ไม่พบเอกสาร');
    await this.assertContractAccess(document.contractId, actor);
  }

  async findByContract(contractId: string, page = 1, limit = 50) {
    this.assertOperation('findByContract', contractId);
    const safeLimit = Math.min(limit, 100);
    if (this.managed) {
      if (!(await this.referencesVisible(contractId)))
        return {
          availability: 'unavailable',
          data: [],
          total: null,
          page,
          limit: safeLimit,
        } satisfies UploadedContractDocumentList;
      const where = { contractId, deletedAt: null };
      const data = await this.db.contractDocument.findMany({
        where,
        select: this.referenceSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      });
      const total = await this.db.contractDocument.count({ where });
      return {
        availability: 'available',
        data: data.map((doc) => this.reference(doc)),
        total,
        page,
        limit: safeLimit,
      } satisfies UploadedContractDocumentList;
    }
    const contract = await this.db.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.db.contractDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      this.db.contractDocument.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }

  /** Get document checklist status */
  async getDocumentChecklist(contractId: string) {
    this.assertOperation('getDocumentChecklist', contractId);
    if (this.managed) {
      const proof = this.proof!;
      const visible = await this.referencesVisible(contractId);
      const required = [
        {
          type: 'SIGNED_CONTRACT',
          label: 'สัญญาผ่อนชำระ PDF (e-Signature ครบ)',
          autoGenerate: true,
        },
        { type: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', autoGenerate: false },
        {
          type: 'KYC_SELFIE',
          label: 'รูปถ่ายลูกค้าถือบัตรประชาชน (Selfie KYC)',
          autoGenerate: false,
        },
        { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า + หน้าจอแสดง IMEI', autoGenerate: false },
      ];
      const documents = visible
        ? await this.db.contractDocument.findMany({
            where: { contractId, isLatest: true, deletedAt: null },
            select: { documentType: true },
          })
        : [];
      const types = new Set<string>(documents.map((doc) => doc.documentType));
      const checklist: UploadedContractDocumentChecklist['checklist'] = required.map((item) => ({
        ...item,
        present: visible ? types.has(item.type) : null,
      }));
      if (proof.requiresGuardian !== false)
        checklist.push({
          type: 'GUARDIAN_DOC',
          label: 'เอกสารผู้ปกครอง (อายุ 17-19)',
          autoGenerate: false,
          conditional: proof.requiresGuardian === null,
          present: visible && proof.requiresGuardian !== null ? types.has('GUARDIAN_DOC') : null,
        });
      return {
        availability: visible ? 'available' : 'unavailable',
        requiresGuardian: proof.requiresGuardian,
        complete:
          visible && proof.requiresGuardian !== null
            ? checklist.every((item) => item.present)
            : null,
        checklist,
      } satisfies UploadedContractDocumentChecklist;
    }
    const contract = await this.db.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { birthDate: true } },
        contractDocuments: {
          where: { isLatest: true, deletedAt: null },
          select: { documentType: true },
        },
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
      {
        type: 'KYC_SELFIE',
        label: 'รูปถ่ายลูกค้าถือบัตรประชาชน (Selfie KYC)',
        autoGenerate: false,
      },
      { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า + หน้าจอแสดง IMEI', autoGenerate: false },
    ];

    if (requiresGuardian) {
      required.push({
        type: 'GUARDIAN_DOC',
        label: 'เอกสารผู้ปกครอง (อายุ 17-19)',
        autoGenerate: false,
      });
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
    this.assertOperation('upload', contractId, userId);
    const contract = await this.db.contract.findUnique({
      where: { id: contractId },
      select: { id: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    if (!VALID_DOCUMENT_TYPES.includes(dto.documentType)) {
      throw new BadRequestException('ประเภทเอกสารไม่ถูกต้อง');
    }
    if (dto.fileUrl.length > 15000000) throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');

    const data =
      /^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(
        dto.fileUrl,
      );
    if (!data) throw new BadRequestException('รองรับไฟล์ JPG, PNG, GIF, WEBP หรือ PDF เท่านั้น');
    const bytes = Buffer.from(data[2], 'base64');
    if (!matchesDocumentMime(bytes, data[1]))
      throw new BadRequestException('เนื้อหาไฟล์ไม่ตรงกับประเภทที่ระบุ กรุณาเลือกไฟล์ใหม่');
    if (!bytes.length || bytes.toString('base64') !== data[2])
      throw new BadRequestException('ข้อมูลไฟล์ไม่สมบูรณ์ กรุณาเลือกไฟล์ใหม่');
    if (bytes.length > 10 * 1024 * 1024) throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');
    const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');

    // Use transaction to ensure version control + audit log are atomic
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
      const currentContract = await tx.contract.findUnique({
        where: { id: contractId },
        select: { id: true, deletedAt: true, status: true, customerId: true, branchId: true },
      });
      if (!currentContract || currentContract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      await tx.$queryRaw`SELECT id FROM contract_documents WHERE contract_id=${contractId}
        AND document_type::text=${dto.documentType} AND is_latest=true AND deleted_at IS NULL ORDER BY id FOR UPDATE`;
      // Version control: mark previous versions as not latest
      const existingLatest = await tx.contractDocument.findFirst({
        where: {
          contractId,
          documentType: dto.documentType as ContractDocumentType,
          isLatest: true,
          deletedAt: null,
        },
        select: { id: true, version: true, isImmutable: true },
      });

      let version = 1;
      if (existingLatest) {
        // Check if existing doc is immutable
        if (existingLatest.isImmutable) {
          throw new BadRequestException(
            `เอกสารประเภท ${dto.documentType} เป็นเอกสารถาวร ไม่สามารถ upload ทับได้`,
          );
        }

        version = existingLatest.version + 1;
        await tx.contractDocument.update({
          where: { id: existingLatest.id },
          data: { isLatest: false },
        });
      }

      // Determine if this document should be immutable
      const isImmutable = isImmutableContractDocument(dto.documentType, currentContract.status);

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

      const request = uploadedDocumentRequest.getStore();
      const legacyProducer =
        !this.managed &&
        request?.operation === 'upload' &&
        request.actorId === userId &&
        request.legacyClient === tx;
      if (this.managed || legacyProducer) {
        await tx.uploadedContractDocumentIdentity.create({
          data: {
            documentId: doc.id,
            contractId,
            customerId: currentContract.customerId,
            branchId: currentContract.branchId,
            producerKind: this.managed ? 'MANAGED_SOURCE' : 'LEGACY_CURRENT_ROLE',
            creationCompany: this.managed ? this.proof!.company : null,
            mimeType: data[1],
            fileSize: bytes.length,
            fileHash,
            inlineValueHash: crypto.createHash('sha256').update(dto.fileUrl).digest('hex'),
          },
        });
      }
      // Log document upload
      await tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          contractId,
          action: 'UPLOAD',
          userId,
          details: this.managed
            ? { version }
            : ({ fileName: dto.fileName, version, fileHash } as Prisma.InputJsonValue),
        },
      });

      return this.managed ? { id: doc.id, version: doc.version } : doc;
    });
  }

  /** Record document view in audit log */
  async recordView(
    contractId: string,
    docId: string,
    userId: string,
    req?: { ip?: string; userAgent?: string },
  ) {
    this.assertOperation('recordView', contractId, userId);
    await this.db.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: this.managed ? 'VIEW_INTENT' : 'VIEW',
        userId,
        ipAddress: this.managed ? undefined : req?.ip,
        userAgent: this.managed ? undefined : req?.userAgent,
      },
    });
    return this.managed ? { recorded: 'VIEW_INTENT' as const } : undefined;
  }

  /** Record document download in audit log */
  async recordDownload(
    contractId: string,
    docId: string,
    userId: string,
    req?: { ip?: string; userAgent?: string },
  ) {
    this.assertOperation('recordDownload', contractId, userId);
    await this.db.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: this.managed ? 'DOWNLOAD_INTENT' : 'DOWNLOAD',
        userId,
        ipAddress: this.managed ? undefined : req?.ip,
        userAgent: this.managed ? undefined : req?.userAgent,
      },
    });
    return this.managed ? { recorded: 'DOWNLOAD_INTENT' as const } : undefined;
  }

  async remove(contractId: string, docId: string, userId: string, userRole: string) {
    this.assertOperation('remove', contractId, userId);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${contractId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM contract_documents WHERE id=${docId} FOR UPDATE`;
      return this.removeCurrent(contractId, docId, userId, userRole, tx);
    });
  }
  private async removeCurrent(
    contractId: string,
    docId: string,
    userId: string,
    userRole: string,
    tx: Prisma.TransactionClient,
  ) {
    const doc = await tx.contractDocument.findFirst({
      where: { id: docId, contractId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    // Check immutability
    if (doc.isImmutable) {
      throw new ForbiddenException('เอกสารนี้เป็นเอกสารถาวร ห้ามลบเด็ดขาด');
    }

    // Check if contract is ACTIVE - prevent deletion of documents for active contracts
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (contract && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new ForbiddenException('ห้ามลบเอกสารของสัญญาที่ ACTIVE');
    }

    // Only OWNER and BRANCH_MANAGER can delete
    if (!this.managed && !['OWNER', 'BRANCH_MANAGER'].includes(userRole)) {
      throw new ForbiddenException('เฉพาะผู้จัดการหรือเจ้าของร้านเท่านั้นที่สามารถลบเอกสาร');
    }

    // Log deletion
    await tx.documentAuditLog.create({
      data: {
        documentId: docId,
        contractId,
        action: 'DELETE',
        userId,
      },
    });

    const removed = await tx.contractDocument.update({
      where: { id: docId },
      data: { deletedAt: new Date() },
    });
    return this.managed ? { id: docId, deleted: true } : removed;
  }

  /** Get document audit trail */
  async getDocumentAuditTrail(contractId: string) {
    this.assertOperation('getDocumentAuditTrail', contractId);
    if (this.managed) {
      if (!(await this.referencesVisible(contractId, true)))
        return {
          availability: 'unavailable',
          total: null,
          data: [],
        } satisfies UploadedContractDocumentHistory;
      const actions = [
        'UPLOAD',
        'VIEW',
        'VIEW_INTENT',
        'DOWNLOAD',
        'DOWNLOAD_INTENT',
        'DELETE',
        'PRINT',
        'HASH_MISMATCH',
        'CONTENT_RELEASE_AUTHORIZED',
      ];
      const ids = await this.db.$queryRaw<
        Array<{ id: string }>
      >`SELECT a.id FROM document_audit_logs a
        JOIN contract_documents d ON d.id=a.document_id AND d.contract_id=a.contract_id
        WHERE a.contract_id=${contractId} AND a.action=ANY(${actions}::text[])
        ORDER BY a.created_at DESC,a.id DESC LIMIT 100`;
      const [count] = await this.db.$queryRaw<
        Array<{ total: number }>
      >`SELECT COUNT(*)::int AS total FROM document_audit_logs a
        JOIN contract_documents d ON d.id=a.document_id AND d.contract_id=a.contract_id
        WHERE a.contract_id=${contractId} AND a.action=ANY(${actions}::text[])`;
      const logs = await this.db.documentAuditLog.findMany({
        where: { id: { in: ids.map((item) => item.id) } },
        select: { action: true, createdAt: true, userId: true, documentId: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const documents = await this.db.contractDocument.findMany({
        where: { id: { in: logs.map((log) => log.documentId) }, contractId },
        select: this.referenceSelect,
      });
      const actors = new Set(
        (
          await this.db.user.findMany({
            where: { id: { in: logs.flatMap((log) => (log.userId ? [log.userId] : [])) } },
            select: { id: true },
          })
        ).map((actor) => actor.id),
      );
      const references = new Map(documents.map((doc) => [doc.id, this.reference(doc)]));
      return {
        availability: 'available',
        total: count.total,
        data: logs.map((log) => ({
          action: (log.action === 'VIEW'
            ? 'VIEW_INTENT'
            : log.action === 'DOWNLOAD'
              ? 'DOWNLOAD_INTENT'
              : log.action === 'PRINT'
                ? 'PRINT_INTENT'
                : log.action) as UploadedContractDocumentActivity,
          createdAt: log.createdAt.toISOString(),
          actorId: log.userId && actors.has(log.userId) ? log.userId : null,
          document: references.get(log.documentId)!,
        })),
      } satisfies UploadedContractDocumentHistory;
    }
    return this.db.documentAuditLog.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
