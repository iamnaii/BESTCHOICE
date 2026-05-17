import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  buildStartsWithPrefix,
  formatDocNumber,
  getPeriodBounds,
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

    // W2 (DEEP review): if digitCount is being REDUCED, reject the update when
    // the current period already contains a doc whose seq cannot fit in the new
    // width. Otherwise the next .next() call would emit a colliding number.
    if (
      dto.digitCount !== undefined &&
      dto.digitCount < before.digitCount
    ) {
      const maxAllowed = Math.pow(10, dto.digitCount) - 1;
      const cadence = (dto.resetCadence ?? before.resetCadence) as ResetCadence;
      const prefix = dto.prefix ?? before.prefix;
      const format = dto.format ?? before.format;
      const existingMax = await this.findMaxExistingSeq(
        docType,
        prefix,
        format,
        cadence,
      );
      if (existingMax > maxAllowed) {
        throw new BadRequestException(
          `ไม่สามารถลด digitCount เป็น ${dto.digitCount} ได้ — มีเอกสาร seq=${existingMax} ในงวดปัจจุบัน (max ใหม่=${maxAllowed})`,
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.prefix !== undefined) data.prefix = dto.prefix;
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.resetCadence !== undefined) data.resetCadence = dto.resetCadence;
    if (dto.digitCount !== undefined) data.digitCount = dto.digitCount;
    if (dto.active !== undefined) data.active = dto.active;
    // W6 (DEEP review): treat blank / whitespace-only notes as NULL so the
    // table doesn't accumulate empty strings vs nulls representing "no note".
    if (dto.notes !== undefined) {
      const trimmed = dto.notes?.trim();
      data.notes = trimmed ? trimmed : null;
    }
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

  /**
   * W2 (DEEP review): used by the digit-reduction guard. Returns the highest
   * sequence number currently issued for this docType in the *current* period
   * (so a DAILY config looks at today's BKK day, MONTHLY at this BKK month).
   *
   * Returns 0 when no matches exist or the docType has no known source table.
   * Best-effort across all known source tables — false negatives are tolerable
   * (the guard just won't fire), false positives are not (would block valid
   * shrinks). All probes share the same startsWith / period bounds.
   */
  private async findMaxExistingSeq(
    docType: string,
    prefix: string,
    format: string,
    cadence: ResetCadence,
  ): Promise<number> {
    const now = new Date();
    const startsWith = buildStartsWithPrefix(format, prefix, now);
    // Period bounds aren't used directly in startsWith match (the formatted
    // YYYYMMDD already scopes to the period) but we compute them so future
    // queries that need an explicit date window can use them.
    getPeriodBounds(now, cadence);

    const probes: Promise<number>[] = [];
    // Route to the right source table by docType. Add new docTypes here when
    // SP5+ wires more modules to DocumentNumberConfig (CT contracts, etc.).
    // CT (Contract) — see migration comment + getContractDescription() below.
    // Currently contracts use Contract.generateContractNumber() inline so we
    // don't probe a contract table here; SP5 may wire it up.
    if (docType === 'EX' || docType === 'CN' || docType === 'PR' || docType === 'SE') {
      probes.push(this.probeExpenseDocs(startsWith));
    }
    if (docType === 'OI') {
      probes.push(this.probeOtherIncomeDocs(startsWith));
    }
    if (docType === 'RT') {
      probes.push(this.probeOtherIncomeReceipts(startsWith));
    }
    // PC (PettyCashReimbursement) and CT (Contract) deliberately have no
    // probe yet — see comments above. Falls through to 0 = guard skipped.

    if (probes.length === 0) return 0;
    const results = await Promise.all(probes);
    return results.reduce((acc, n) => (n > acc ? n : acc), 0);
  }

  /**
   * Description lookups for known docTypes. Kept beside the service so the
   * seed table in `20260939000000_add_document_number_config/migration.sql`
   * stays the source of truth — these comments document each row's intent.
   *
   * W7 (DEEP review): CT (Contract) row is seeded for *future* use. Currently
   * Contract numbers come from Contract.generateContractNumber() inline.
   * SP5 may wire ContractsService to DocumentNumberConfig so it shows up here.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private getContractDescription(): string {
    // Placeholder for forward-compat. Description is already persisted in the
    // CT seed row (`สัญญา (Contract)`); this method exists only so a grep for
    // "contract" lands developers on the W7 note above before they assume the
    // seed is orphaned and rip it out.
    return 'สัญญา (Contract)';
  }
}
