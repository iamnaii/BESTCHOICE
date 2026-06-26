import { Injectable } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { PettyCashCustodianRole, DocNumberFormatValue, DocNumberResetCycleValue } from './settings.constants';
import { SettingsFlagsService } from './services/settings-flags.service';
import { SettingsWriteService } from './services/settings-write.service';
import { PettyCashCustodianService } from './services/petty-cash-custodian.service';
import { DocNumberPreviewService } from './services/doc-number-preview.service';

// Re-export module-level constants/types from their shared home so existing
// external importers (e.g. expense-documents/services/doc-number.service)
// that pull these from `settings.service` keep working unchanged.
export {
  DEFAULT_DOC_PREFIX_MAP,
  DOC_PREFIX_REGEX,
  VALID_DOC_NUMBER_FORMATS,
  DEFAULT_DOC_NUMBER_FORMAT_VALUE,
  VALID_DOC_NUMBER_RESET_CYCLES,
  DEFAULT_DOC_NUMBER_RESET_CYCLE,
  EXTRA_DOC_TYPE_KEYS,
  DEFAULT_EXTRA_DOC_PREFIX_MAP,
} from './settings.constants';
export type {
  DocNumberFormatValue,
  DocNumberResetCycleValue,
  ExtraDocTypeKey,
} from './settings.constants';

/**
 * Facade over the decomposed Settings cluster (Wave-4). The public surface
 * (16 methods consumed by the controller + 5 external modules:
 * `contracts/documents.service` findAll; `expense-documents/services/doc-number.service`
 * getDocPrefixMap+getKey; `collections-session/auto-assign.service`+`pool.service`
 * getCollectionsConfig; etc.) is preserved byte-for-byte and each method is a
 * one-line delegation to the sub-service that owns it:
 *   - SettingsFlagsService        — read-mostly flag accessors (dependency root,
 *                                   owns the now-public `getKey`)
 *   - SettingsWriteService        — findAll/update/bulkUpdate (sole $transaction)
 *   - PettyCashCustodianService   — petty-cash custodian assignment
 *   - DocNumberPreviewService     — doc-number preview + sequence-reset
 */
@Injectable()
export class SettingsService {
  constructor(
    private flags: SettingsFlagsService,
    private write: SettingsWriteService,
    private pettyCash: PettyCashCustodianService,
    private docNumberPreview: DocNumberPreviewService,
  ) {}

  // ─── Write slice (SettingsWriteService) ──────────────────────────────

  async findAll() {
    return this.write.findAll();
  }

  async update(key: string, value: string, userId?: string, userRole?: string) {
    return this.write.update(key, value, userId, userRole);
  }

  async bulkUpdate(
    items: { key: string; value: string }[],
    userId?: string,
    userRole?: string,
  ) {
    return this.write.bulkUpdate(items, userId, userRole);
  }

  // ─── Flag accessors (SettingsFlagsService) ───────────────────────────

  async getKey(key: string): Promise<string | null> {
    return this.flags.getKey(key);
  }

  async isExportEnabled(): Promise<boolean> {
    return this.flags.isExportEnabled();
  }

  async getWhtRates(): Promise<
    { rate: number; label: string; effectiveDate?: string | null }[]
  > {
    return this.flags.getWhtRates();
  }

  async getReverseReasons(): Promise<{ code: string; label: string }[]> {
    return this.flags.getReverseReasons();
  }

  async getWaiverReasons(): Promise<{ code: string; label: string }[]> {
    return this.flags.getWaiverReasons();
  }

  async getDocPrefixMap(): Promise<Record<DocumentType, string>> {
    return this.flags.getDocPrefixMap();
  }

  async getUiFlags(): ReturnType<SettingsFlagsService['getUiFlags']> {
    return this.flags.getUiFlags();
  }

  async getCollectionsConfig(): Promise<{
    dailyCap: number;
    workloadFloor: number;
    etaPerContractMin: number;
    sessionTargetMin: number;
    selfClaimLockHours: number;
  }> {
    return this.flags.getCollectionsConfig();
  }

  // ─── Petty Cash custodian (PettyCashCustodianService) ────────────────

  async getPettyCashCustodianRole(): Promise<PettyCashCustodianRole> {
    return this.pettyCash.getPettyCashCustodianRole();
  }

  async getPettyCashCustodian(
    companyId?: string,
  ): Promise<{
    companyId: string;
    companyCode: string | null;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  } | null> {
    return this.pettyCash.getPettyCashCustodian(companyId);
  }

  async assignPettyCashCustodian(
    actorUserId: string,
    opts: { companyId?: string; userId: string | null | undefined },
  ): Promise<{
    companyId: string;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  }> {
    return this.pettyCash.assignPettyCashCustodian(actorUserId, opts);
  }

  async getEligibleCustodians(): Promise<
    { id: string; name: string; email: string; role: string }[]
  > {
    return this.pettyCash.getEligibleCustodians();
  }

  // ─── Doc-number preview + reset (DocNumberPreviewService) ─────────────

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
    return this.docNumberPreview.resetDocSequence(docType, periodStart, userId);
  }

  async previewNumber(
    docType: string,
    format?: string,
    prefix?: string,
    resetCycle?: string,
    issueDate?: Date,
  ): Promise<{ sample: string; format: DocNumberFormatValue; resetCycle: DocNumberResetCycleValue; prefix: string }> {
    return this.docNumberPreview.previewNumber(docType, format, prefix, resetCycle, issueDate);
  }
}
