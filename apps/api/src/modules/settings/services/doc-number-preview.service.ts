import { Injectable } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SettingsFlagsService } from './settings-flags.service';
import {
  DOC_PREFIX_REGEX,
  VALID_DOC_NUMBER_FORMATS,
  DocNumberFormatValue,
  DEFAULT_DOC_NUMBER_FORMAT_VALUE,
  VALID_DOC_NUMBER_RESET_CYCLES,
  DocNumberResetCycleValue,
  DEFAULT_DOC_NUMBER_RESET_CYCLE,
  EXTRA_DOC_TYPE_KEYS,
  ExtraDocTypeKey,
  DEFAULT_EXTRA_DOC_PREFIX_MAP,
} from '../settings.constants';

/**
 * Document-number preview + sequence-reset slice of the decomposed
 * SettingsService (Wave-4). Depends on SettingsFlagsService for the shared
 * `getKey` / `getDocPrefixMap` reads (cross-cluster). All method bodies are
 * byte-identical to the original; only the `this.getKey`/`this.getDocPrefixMap`
 * calls were rewritten to `this.flags.getKey` / `this.flags.getDocPrefixMap`,
 * plus `this.prisma`/`this.audit` field resolution + import paths changed.
 */
@Injectable()
export class DocNumberPreviewService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private flags: SettingsFlagsService,
  ) {}

  /**
   * D1.1.2.5 — admin-only document-number sequence reset endpoint helper.
   *
   * Current `DocNumberService` derives the next sequence from
   * `MAX(docNumber)` at every call, so deleting documents (e.g. soft-deleting
   * an erroneous row) implicitly resets the sequence. This endpoint exists
   * as a forward-extension stub for a future migration to a dedicated
   * `DocumentSequence` Prisma model (see D1.1.2.4) — at that point this
   * method will UPDATE the stored sequence row directly.
   *
   * Today the method:
   *  - validates the docType (DocumentType enum)
   *  - returns a snapshot of the CURRENT max sequence per doc type across
   *    the whole `ExpenseDocument` table for diagnostic / sanity-check
   *    purposes
   *  - writes an immutable AuditLog with action `DOC_SEQUENCE_RESET`
   *
   * Note: the response does NOT actually mutate any sequence rows. The
   * intent is to let OWNER preview what the next-issued number would look
   * like and have a traceable audit record of their reset intention.
   */
  async resetDocSequence(
    docType: DocumentType,
    periodStart: string,
    userId: string,
  ): Promise<{
    docType: DocumentType;
    periodStart: string;
    note: string;
    currentMaxByType: Record<string, string | null>;
  }> {
    // Collect the latest issued number per DocumentType in one round-trip.
    const maxRows = await this.prisma.expenseDocument.groupBy({
      by: ['documentType'],
      _max: { number: true },
    });
    const currentMaxByType: Record<string, string | null> = {};
    for (const t of Object.values(DocumentType)) {
      currentMaxByType[t] = null;
    }
    for (const row of maxRows) {
      currentMaxByType[row.documentType] = row._max.number ?? null;
    }

    await this.audit.log({
      userId,
      action: 'DOC_SEQUENCE_RESET',
      entity: 'DocumentSequence',
      entityId: `${docType}:${periodStart}`,
      newValue: {
        docType,
        periodStart,
        currentMaxByType,
      },
    });

    return {
      docType,
      periodStart,
      note: 'Sequence resets implicitly when documents in the requested period are deleted. The current MAX(docNumber) per type is returned for diagnostic purposes. A future migration to a dedicated DocumentSequence model will enable explicit sequence mutation here.',
      currentMaxByType,
    };
  }

  /**
   * P2-SP2 — generate a sample "next" document number for the Document Config UI
   * live preview. Pure function: builds the string from explicit overrides
   * (or persisted SystemConfig defaults) WITHOUT touching expense_documents or
   * any sequence state. Always returns seq=1 (the visual "what the next number
   * would look like" scenario the OWNER cares about when comparing layouts).
   *
   * Args:
   *   - docType: any string (canonical DocumentType OR an extra UI-only key
   *              like OTHER_INCOME / RECEIPT / CONTRACT). Falls back to the
   *              first letter of the docType if no prefix is configured.
   *   - format: optional override; defaults to the configured
   *             `doc_number_format` (or PREFIX-YYMM-NNN spec default).
   *   - prefix: optional override; defaults to the configured prefix for
   *             `docType` (or the canonical default).
   *   - resetCycle: not directly visible in the rendered string but exposed
   *             for forward-compat (future variants may key the date portion
   *             on the cycle boundary). Currently informational — the date
   *             portion follows `format`.
   *   - issueDate: optional sample date (default = "now"). Asia/Bangkok local.
   */
  async previewNumber(
    docType: string,
    format?: string,
    prefix?: string,
    resetCycle?: string,
    issueDate?: Date,
  ): Promise<{ sample: string; format: DocNumberFormatValue; resetCycle: DocNumberResetCycleValue; prefix: string }> {
    const sampleDate = issueDate ?? new Date();

    // Resolve format — override → persisted → default.
    let resolvedFormat: DocNumberFormatValue = DEFAULT_DOC_NUMBER_FORMAT_VALUE;
    if (format && (VALID_DOC_NUMBER_FORMATS as readonly string[]).includes(format)) {
      resolvedFormat = format as DocNumberFormatValue;
    } else if (!format) {
      const stored = await this.flags.getKey('doc_number_format');
      if (stored && (VALID_DOC_NUMBER_FORMATS as readonly string[]).includes(stored)) {
        resolvedFormat = stored as DocNumberFormatValue;
      }
    }

    // Resolve resetCycle — override → persisted → default. Informational only
    // for the rendered string (future variants may key date on cycle boundary).
    let resolvedCycle: DocNumberResetCycleValue = DEFAULT_DOC_NUMBER_RESET_CYCLE;
    if (resetCycle && (VALID_DOC_NUMBER_RESET_CYCLES as readonly string[]).includes(resetCycle)) {
      resolvedCycle = resetCycle as DocNumberResetCycleValue;
    } else if (!resetCycle) {
      const stored = await this.flags.getKey('doc_number_reset_cycle');
      if (stored && (VALID_DOC_NUMBER_RESET_CYCLES as readonly string[]).includes(stored)) {
        resolvedCycle = stored as DocNumberResetCycleValue;
      }
    }

    // Resolve prefix — override (validated) → persisted prefix map → default
    // canonical map → first-letter fallback for unknown extras.
    let resolvedPrefix: string;
    if (prefix && DOC_PREFIX_REGEX.test(prefix)) {
      resolvedPrefix = prefix;
    } else {
      // Canonical map first (covers all DocumentType values).
      const canonicalMap = await this.flags.getDocPrefixMap();
      if ((Object.keys(canonicalMap) as string[]).includes(docType)) {
        resolvedPrefix = canonicalMap[docType as DocumentType];
      } else if ((EXTRA_DOC_TYPE_KEYS as readonly string[]).includes(docType)) {
        // Read any persisted override from doc_prefix_per_type for the extra key.
        const raw = await this.flags.getKey('doc_prefix_per_type');
        let extraOverride: string | undefined;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const candidate = (parsed as Record<string, unknown>)[docType];
              if (typeof candidate === 'string' && DOC_PREFIX_REGEX.test(candidate)) {
                extraOverride = candidate;
              }
            }
          } catch {
            // fall through
          }
        }
        resolvedPrefix = extraOverride ?? DEFAULT_EXTRA_DOC_PREFIX_MAP[docType as ExtraDocTypeKey];
      } else {
        // Unknown docType — best-effort: first 2 chars uppercased.
        resolvedPrefix = (docType.slice(0, 2) || 'XX').toUpperCase();
      }
    }

    const { datePortion, seqWidth } = this.layoutFor(sampleDate, resolvedFormat);
    const seq = String(1).padStart(seqWidth, '0');
    return {
      sample: `${resolvedPrefix}-${datePortion}-${seq}`,
      format: resolvedFormat,
      resetCycle: resolvedCycle,
      prefix: resolvedPrefix,
    };
  }

  /**
   * P2-SP2 — pure layout helper for `previewNumber`. Mirrors the logic in
   * `DocNumberService.layout` but lives here as well so SettingsService stays
   * dependency-free. Keep the two in sync.
   */
  private layoutFor(
    issueDate: Date,
    format: DocNumberFormatValue,
  ): { datePortion: string; seqWidth: number } {
    switch (format) {
      case 'PREFIX-YYYYMM-NNNNN':
        return { datePortion: this.bkkYyyymm(issueDate), seqWidth: 5 };
      case 'PREFIX-YYYY-NNNNNN':
        return { datePortion: this.bkkYyyy(issueDate), seqWidth: 6 };
      case 'PREFIX-YYYYMMDD-NNNN':
        return { datePortion: this.bkkYyyymmdd(issueDate), seqWidth: 4 };
      case 'PREFIX-YYMM-NNN':
      default:
        return { datePortion: this.bkkYymm(issueDate), seqWidth: 3 };
    }
  }

  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  private bkkYyyymm(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    });
    return parts.split('-').slice(0, 2).join('');
  }

  private bkkYyyy(date: Date): string {
    return date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
    });
  }

  private bkkYymm(date: Date): string {
    const yyyymm = this.bkkYyyymm(date);
    return yyyymm.slice(2);
  }
}
