import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  buildStartsWithPrefix,
  formatDocNumber,
  type ResetCadence,
} from '../../../utils/doc-number-format.util';
import { UpdateDocConfigDto, PreviewDocConfigDto } from './dto/update-doc-config.dto';

@Injectable()
export class DocConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.documentNumberConfig.findMany({
      where: { deletedAt: null },
      orderBy: { docType: 'asc' },
      include: {
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findByType(docType: string) {
    const config = await this.prisma.documentNumberConfig.findUnique({
      where: { docType },
      include: {
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!config || config.deletedAt) {
      throw new NotFoundException(`ไม่พบการตั้งค่าเลขที่เอกสารประเภท ${docType}`);
    }
    return config;
  }

  /**
   * Update a config row + write an audit log entry. Audit happens AFTER the
   * commit succeeds — failure to write audit must never roll back the config
   * change (AuditService.log swallows errors internally).
   */
  async update(docType: string, dto: UpdateDocConfigDto, userId: string) {
    const before = await this.findByType(docType);

    const data: Record<string, unknown> = {};
    if (dto.prefix !== undefined) data.prefix = dto.prefix;
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.resetCadence !== undefined) data.resetCadence = dto.resetCadence;
    if (dto.digitCount !== undefined) data.digitCount = dto.digitCount;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.notes !== undefined) data.notes = dto.notes;
    data.updatedById = userId;

    const updated = await this.prisma.documentNumberConfig.update({
      where: { docType },
      data,
      include: {
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'DOC_NUMBER_CONFIG_UPDATED',
      entity: 'document_number_config',
      entityId: docType,
      oldValue: {
        prefix: before.prefix,
        format: before.format,
        resetCadence: before.resetCadence,
        digitCount: before.digitCount,
        active: before.active,
        notes: before.notes,
      },
      newValue: {
        prefix: updated.prefix,
        format: updated.format,
        resetCadence: updated.resetCadence,
        digitCount: updated.digitCount,
        active: updated.active,
        notes: updated.notes,
      },
    });

    return updated;
  }

  /**
   * Preview the next number that would be issued if the (override) config is
   * applied. Reads the existing row for defaults, overrides with anything
   * provided in `body`, computes the next sequence number scoped to the
   * implied period, then formats the result.
   */
  async preview(docType: string, body: PreviewDocConfigDto) {
    const existing = await this.findByType(docType);

    const prefix = body.prefix ?? existing.prefix;
    const format = body.format ?? existing.format;
    const resetCadence = (body.resetCadence ?? existing.resetCadence) as ResetCadence;
    const digitCount = body.digitCount ?? existing.digitCount;
    const sampleDate = body.sampleDate ? new Date(body.sampleDate) : new Date();
    if (Number.isNaN(sampleDate.getTime())) {
      // Fall back silently to "now" — caller likely passed a malformed date,
      // but we still want a useful preview rather than a 500.
      sampleDate.setTime(Date.now());
    }

    // Best-effort nextSeq lookup. For DAILY/MONTHLY/YEARLY/NEVER we count
    // existing numbers in the period regardless of source table (OI / expense /
    // contract / etc.) — preview only needs to ESTIMATE, not be transactional.
    let nextSeq = 1;
    try {
      const startsWith = buildStartsWithPrefix(format, prefix, sampleDate);
      // Probe several candidate source tables. Each may or may not exist.
      // Returns the highest seq found across all probes.
      const probes = await Promise.all([
        this.probeExpenseDocs(startsWith),
        this.probeOtherIncomeDocs(startsWith),
        this.probeOtherIncomeReceipts(startsWith),
      ]);
      const maxSeq = probes.reduce((acc, n) => (n > acc ? n : acc), 0);
      nextSeq = maxSeq + 1;
    } catch {
      nextSeq = 1;
    }

    const sample = formatDocNumber(format, prefix, nextSeq, sampleDate, digitCount);
    return { sample, nextSeq, format, prefix, resetCadence, digitCount };
  }

  private async probeExpenseDocs(startsWith: string): Promise<number> {
    try {
      const last = await this.prisma.expenseDocument.findFirst({
        where: { number: { startsWith } },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      if (!last) return 0;
      const tail = last.number.slice(startsWith.length).match(/^(\d+)/);
      return tail ? parseInt(tail[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private async probeOtherIncomeDocs(startsWith: string): Promise<number> {
    try {
      const last = await this.prisma.otherIncome.findFirst({
        where: { docNumber: { startsWith } },
        orderBy: { docNumber: 'desc' },
        select: { docNumber: true },
      });
      if (!last) return 0;
      const tail = last.docNumber.slice(startsWith.length).match(/^(\d+)/);
      return tail ? parseInt(tail[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private async probeOtherIncomeReceipts(startsWith: string): Promise<number> {
    try {
      const last = await this.prisma.otherIncome.findFirst({
        where: { receiptNo: { startsWith } },
        orderBy: { receiptNo: 'desc' },
        select: { receiptNo: true },
      });
      if (!last?.receiptNo) return 0;
      const tail = last.receiptNo.slice(startsWith.length).match(/^(\d+)/);
      return tail ? parseInt(tail[1], 10) : 0;
    } catch {
      return 0;
    }
  }
}
