import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocNumberService } from './services/doc-number.service';
import { ValidationService } from './services/validation.service';
import { AutoJournalService } from './services/auto-journal.service';
import { OtherIncomeTemplate } from './templates/other-income.template';
import { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { ListOtherIncomeQueryDto } from './dto/list-other-income-query.dto';
import { JournalOverrideService } from './services/journal-override.service';
import { AuditService } from '../audit/audit.service';
import { OtherIncomeConfigService } from './services/other-income-config.service';
import { OtherIncomeLifecycleService } from './services/other-income-lifecycle.service';
import { OtherIncomeReportService } from './services/other-income-report.service';

/**
 * Facade for the OtherIncome module. Keeps the 19-method public surface + an
 * UNCHANGED 8-dep constructor so specs (Test.createTestingModule mocking the
 * deps), the module providers, and the RepairTickets consumer are untouched.
 *
 * Internally constructs three plain sub-services from the injected deps:
 * - OtherIncomeConfigService     — SystemConfig flags + thresholds
 * - OtherIncomeLifecycleService  — money core: all 7 $transaction (docNumber +
 *   writes + template.post JE atomic), findOneOrFail, shared helpers
 * - OtherIncomeReportService     — read-only dailySheet / list / getAuditTrail
 *
 * uploadAttachment (storage + magic-byte check) stays on the facade — low
 * coupling (delegates findOneOrFail to lifecycle, then talks to storage).
 */
@Injectable()
export class OtherIncomeService {
  private readonly config: OtherIncomeConfigService;
  private readonly lifecycle: OtherIncomeLifecycleService;
  private readonly report: OtherIncomeReportService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly validation: ValidationService,
    private readonly autoJournal: AutoJournalService,
    private readonly template: OtherIncomeTemplate,
    private readonly storage: StorageService,
    private readonly journalOverride: JournalOverrideService,
    private readonly audit: AuditService,
  ) {
    this.config = new OtherIncomeConfigService(this.prisma, this.audit);
    this.lifecycle = new OtherIncomeLifecycleService(
      this.prisma,
      this.docNumber,
      this.validation,
      this.autoJournal,
      this.template,
      this.journalOverride,
      this.audit,
      this.config,
    );
    this.report = new OtherIncomeReportService(this.prisma, this.lifecycle);
  }

  // ─── Lifecycle (money core — delegates to OtherIncomeLifecycleService) ─────

  create(dto: CreateOtherIncomeDto, userId: string) {
    return this.lifecycle.create(dto, userId);
  }

  createDraftForRepair(
    dto: {
      accountCode: string;
      counterpartyName: string;
      customerId: string;
      amount: Prisma.Decimal;
      description: string;
      receivedAt: Date;
      branchId: string;
      createdById: string;
      metadata: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return this.lifecycle.createDraftForRepair(dto, tx);
  }

  update(id: string, dto: UpdateOtherIncomeDto, userId: string) {
    return this.lifecycle.update(id, dto, userId);
  }

  softDelete(id: string, userId: string) {
    return this.lifecycle.softDelete(id, userId);
  }

  requestApproval(id: string, userId: string) {
    return this.lifecycle.requestApproval(id, userId);
  }

  approve(id: string, dto: { note?: string }, userId: string) {
    return this.lifecycle.approve(id, dto, userId);
  }

  reject(id: string, dto: { note: string }, userId: string) {
    return this.lifecycle.reject(id, dto, userId);
  }

  post(id: string, dto: PostOtherIncomeDto, userId: string) {
    return this.lifecycle.post(id, dto, userId);
  }

  reverse(id: string, dto: ReverseOtherIncomeDto, userId: string) {
    return this.lifecycle.reverse(id, dto, userId);
  }

  copy(id: string, userId: string) {
    return this.lifecycle.copy(id, userId);
  }

  findOneOrFail(id: string) {
    return this.lifecycle.findOneOrFail(id);
  }

  // ─── Reports (delegates to OtherIncomeReportService) ───────────────────────

  dailySheet(startDate: string, endDate: string) {
    return this.report.dailySheet(startDate, endDate);
  }

  list(query: ListOtherIncomeQueryDto) {
    return this.report.list(query);
  }

  getAuditTrail(id: string) {
    return this.report.getAuditTrail(id);
  }

  // ─── Config (delegates to OtherIncomeConfigService) ────────────────────────

  isMakerCheckerEnabled(): Promise<boolean> {
    return this.config.isMakerCheckerEnabled();
  }

  setMakerCheckerEnabled(enabled: boolean, userId: string): Promise<{ success: true; enabled: boolean }> {
    return this.config.setMakerCheckerEnabled(enabled, userId);
  }

  pendingReadyCount(): Promise<{ count: number }> {
    return this.config.pendingReadyCount();
  }

  getAttachmentThreshold(): Promise<number> {
    return this.config.getAttachmentThreshold();
  }

  // -------------------------------------------------------------------------
  // uploadAttachment(): store file in S3/GCS + create OtherIncomeAttachment row
  // -------------------------------------------------------------------------

  async uploadAttachment(id: string, file: Express.Multer.File, userId: string) {
    const doc = await this.findOneOrFail(id);

    // Maker-Checker integrity (PDF Section 5 rule 5): once the doc has left
    // DRAFT, the attachments the approver/auditor saw must be frozen. Allowing
    // late uploads on READY/POSTED/REVERSED would let a maker swap evidence
    // after approval.
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — แนบไฟล์ได้เฉพาะตอนเป็น DRAFT`,
      );
    }

    // Defence-in-depth: controller's FileTypeValidator only inspects the
    // Content-Type header (client-controlled). Re-verify against magic bytes
    // here so a `.jpg` MIME wrapper around an SVG/exe payload is rejected
    // before we persist anything (PII attachments).
    if (!this.matchesMimeMagicBytes(file)) {
      throw new BadRequestException(
        'ประเภทไฟล์ไม่ตรงกับเนื้อหา (รองรับเฉพาะ PDF, JPEG, PNG, WEBP)',
      );
    }

    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // eslint-disable-next-line no-control-regex
    const safeName = decodedName.replace(/[<>:"/\\|?*\x00-\s]/g, '_');
    const key = `other-income/${id}/${Date.now()}-${randomUUID()}-${safeName}`;

    await this.storage.upload(key, file.buffer, file.mimetype);

    try {
      return await this.prisma.otherIncomeAttachment.create({
        data: {
          otherIncomeId: id,
          s3Key: key,
          filename: decodedName,
          size: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
        },
      });
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Confirms the uploaded file's first bytes match the declared mimetype.
   * Lightweight built-in check (no extra dep). Covers PDF/JPEG/PNG/WEBP —
   * which are the only types the upload pipe accepts.
   * Returns true if header matches; false on mismatch or unknown type.
   */
  private matchesMimeMagicBytes(file: Express.Multer.File): boolean {
    const buf = file.buffer;
    if (!buf || buf.length < 12) return false;
    const mime = file.mimetype;

    if (mime === 'application/pdf') {
      // %PDF-
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
    }
    if (mime === 'image/jpeg') {
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (mime === 'image/png') {
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    }
    if (mime === 'image/webp') {
      // RIFF .... WEBP  (offset 0-3 = 'RIFF', offset 8-11 = 'WEBP')
      return (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      );
    }
    return false;
  }
}
