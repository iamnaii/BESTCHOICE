import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateLegalCaseDto } from './dto/create-legal-case.dto';
import { UpdateLegalCaseDto } from './dto/update-legal-case.dto';
import {
  AllowedLegalDocMime,
  PresignLegalDocumentDto,
  RegisterLegalDocumentDto,
} from './dto/upload-document.dto';

/**
 * LegalCaseService (P2 Task 7).
 *
 * 1:1 mapping between Contract and LegalCase. Documents are append-only
 * legal evidence (no soft-delete on `LegalCaseDocument` — see schema doc).
 *
 * The case itself can be soft-deleted (e.g. case dismissed in error) but
 * documents survive forever.
 */
@Injectable()
export class LegalCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(contractId: string, dto: CreateLegalCaseDto) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญานี้');
    }

    const existing = await this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('สัญญานี้มีคดีอยู่แล้ว');
    }

    const created = await this.prisma.legalCase.create({
      data: {
        contractId,
        caseNumber: dto.caseNumber,
        court: dto.court,
        hearingDate: dto.hearingDate ? new Date(dto.hearingDate) : null,
        lawyerName: dto.lawyerName ?? null,
        lawyerPhone: dto.lawyerPhone ?? null,
        notes: dto.notes ?? null,
      },
      include: {
        documents: { orderBy: { uploadedAt: 'desc' } },
      },
    });

    // Recording lifecycle: ทันทีที่เปิดคดี → LEGAL_HOLD (override CLOSED/STANDARD)
    // ป้องกัน GCS lifecycle cron ย้าย recording ไป tier ถูกกว่า — ระหว่างคดี
    // ต้องเก็บไว้เป็นหลักฐานในรูปแบบ instant-access
    await this.prisma.callLog.updateMany({
      where: {
        contractId,
        recordingUrl: { not: null },
        deletedAt: null,
      },
      data: { recordingStorageTier: 'LEGAL_HOLD' },
    });

    return created;
  }

  async findByContract(contractId: string) {
    return this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      include: {
        documents: {
          orderBy: { uploadedAt: 'desc' },
        },
      },
    });
  }

  async update(contractId: string, dto: UpdateLegalCaseDto) {
    const found = await this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('ไม่พบคดีของสัญญานี้');
    }

    const data: Record<string, unknown> = {};
    if (dto.caseNumber !== undefined) data.caseNumber = dto.caseNumber;
    if (dto.court !== undefined) data.court = dto.court;
    if (dto.hearingDate !== undefined) {
      data.hearingDate = dto.hearingDate ? new Date(dto.hearingDate) : null;
    }
    if (dto.lawyerName !== undefined) data.lawyerName = dto.lawyerName;
    if (dto.lawyerPhone !== undefined) data.lawyerPhone = dto.lawyerPhone;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.legalCase.update({
      where: { id: found.id },
      data,
      include: {
        documents: { orderBy: { uploadedAt: 'desc' } },
      },
    });
  }

  async softDelete(contractId: string) {
    const found = await this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('ไม่พบคดีของสัญญานี้');
    }
    await this.prisma.legalCase.update({
      where: { id: found.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async presignDocumentUpload(contractId: string, dto: PresignLegalDocumentDto) {
    const found = await this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('ไม่พบคดีของสัญญานี้');
    }

    const ext = mimeToExt(dto.contentType);
    const key = `legal-cases/${found.id}/${dto.kind}/${randomUUID()}.${ext}`;
    const signed = await this.storage.getSignedUploadUrl(
      key,
      dto.contentType,
      undefined,
      dto.contentLength,
    );
    return {
      uploadUrl: signed.url,
      method: signed.method,
      key,
      publicUrl: this.storage.getPublicUrl(key),
      maxContentLength: dto.contentLength,
    };
  }

  async registerDocument(
    contractId: string,
    userId: string,
    dto: RegisterLegalDocumentDto,
  ) {
    const found = await this.prisma.legalCase.findFirst({
      where: { contractId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('ไม่พบคดีของสัญญานี้');
    }

    // SECURITY: Reject any s3Key that does not live under this case's prefix.
    // Without this, an authenticated user could register a row pointing at any
    // bucket object (e.g. another case's docs, trade-in receipts, etc.) and
    // exfiltrate it via the served public URL.
    const expectedPrefix = `legal-cases/${found.id}/`;
    if (!dto.s3Key.startsWith(expectedPrefix)) {
      throw new BadRequestException('s3Key path ไม่ถูกต้อง');
    }

    return this.prisma.legalCaseDocument.create({
      data: {
        legalCaseId: found.id,
        kind: dto.kind,
        filename: dto.filename,
        s3Url: this.storage.getPublicUrl(dto.s3Key),
        uploadedByUserId: userId,
      },
    });
  }
}

function mimeToExt(mime: AllowedLegalDocMime): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
  }
}
