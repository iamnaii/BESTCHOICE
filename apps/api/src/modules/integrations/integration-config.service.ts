import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptPII, decryptPII, isEncrypted } from '../../utils/crypto.util';
import { getIntegrationDef, INTEGRATIONS } from './integration-registry';

/** Flat map of fieldKey → plaintext value for a single integration. */
export type IntegrationConfig = Record<string, string>;

/** Same shape but sensitive values are masked (e.g. `••••abcd`). */
export type MaskedIntegrationConfig = Record<string, string>;

/**
 * State of INTEGRATION_ENCRYPTION_KEY in this process. Only `ok` is ever used to
 * encrypt or decrypt — a malformed key is treated exactly like a missing one.
 */
export type IntegrationKeyStatus = 'ok' | 'missing' | 'malformed';

/** Same rule as PII_ENCRYPTION_KEY (utils/env-validation.ts): 32 bytes as hex. */
const INTEGRATION_KEY_FORMAT = /^[0-9a-f]{64}$/i;

/** Why a stored credential could not be turned back into plaintext. */
type UndecryptableReason = 'key-missing' | 'key-invalid' | 'decrypt-failed';

/** Result of reading one stored value — never carries ciphertext. */
type StoredRead = { ok: true; value: string } | { ok: false; reason: UndecryptableReason };

/**
 * Encrypted credentials checked against the key this process holds.
 * Entries are `integrationKey.fieldKey` only — never values.
 */
export type EncryptedFieldCheck = { key: IntegrationKeyStatus; ok: string[]; failed: string[] };

@Injectable()
export class IntegrationConfigService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationConfigService.name);

  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cache = new Map<string, { config: IntegrationConfig; cachedAt: number }>();

  /**
   * getValue runs on hot paths (webhook guards on every request, every LINE
   * send) — one warning + one Sentry event per field per hour is enough to be
   * seen without flooding either.
   */
  private static readonly UNDECRYPTABLE_WARN_INTERVAL_MS = 60 * 60 * 1000;
  private undecryptableWarnedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { status } = this.resolveKey();
    if (status === 'missing') {
      this.logger.warn(
        '[IntegrationConfig] INTEGRATION_ENCRYPTION_KEY not set — credentials stored in plaintext!',
      );
      Sentry.captureMessage('INTEGRATION_ENCRYPTION_KEY not configured', 'warning');
    }
    if (status === 'malformed') {
      // Never the value or its length — only the rule it breaks.
      this.logger.error(
        '[IntegrationConfig] INTEGRATION_ENCRYPTION_KEY is malformed (need 64 hex chars) — treated as not set: encrypted credentials read as not configured and new saves are stored unencrypted',
      );
      Sentry.captureMessage('INTEGRATION_ENCRYPTION_KEY malformed (need 64 hex chars)', 'error');
    }
    await this.logEncryptedFieldCheck(status);
  }

  /**
   * Boot self-check: does the key this process holds open every encrypted
   * credential? One log line (field references only — never values) lets ops
   * verify the key after a deploy without reading any secret. Fields that
   * decrypt are named too: a credential nobody remembers entering starts
   * working the moment its key arrives, so ops must know which ones to test.
   * Printed whenever a key is configured (well-formed or not) or encrypted
   * values exist, so "no line" can only mean "no key and nothing encrypted".
   * Never throws: a DB hiccup must not block boot.
   */
  private async logEncryptedFieldCheck(status: IntegrationKeyStatus): Promise<void> {
    let check: EncryptedFieldCheck;
    try {
      check = await this.checkEncryptedFields();
    } catch (err) {
      this.logger.warn(
        `integration encrypted fields: check failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const { ok, failed } = check;
    if (status === 'missing' && ok.length + failed.length === 0) return;

    const line = `integration encrypted fields: key=${status} ok=${ok.length} [${ok.join(', ')}] failed=${failed.length} [${failed.join(', ')}]`;
    if (failed.length === 0 && status === 'ok') {
      this.logger.log(line);
      return;
    }
    this.logger.warn(line);
    if (failed.length === 0) return;
    Sentry.captureMessage('Integration credentials cannot be decrypted with the current key', {
      level: 'warning',
      tags: { subsystem: 'integration-config', key: status },
      extra: { ok: ok.length, failed },
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Read INTEGRATION_ENCRYPTION_KEY: trimmed, and only usable when it is 64 hex
   * chars. A malformed key (e.g. base64 from `openssl rand -base64 32`, or 32
   * hex chars) would otherwise pass decryptPII's length gate and throw
   * "Invalid key length" on every save — it is treated as absent instead.
   */
  private resolveKey(): { status: IntegrationKeyStatus; key: string } {
    const key = (this.configService.get<string>('INTEGRATION_ENCRYPTION_KEY') ?? '').trim();
    if (!key) return { status: 'missing', key: '' };
    if (!INTEGRATION_KEY_FORMAT.test(key)) return { status: 'malformed', key: '' };
    return { status: 'ok', key };
  }

  /** The usable encryption key; empty string when missing or malformed (no encryption). */
  private get encryptionKey(): string {
    return this.resolveKey().key;
  }

  /** Build the SystemConfig DB key for a given integration + field. */
  private dbKey(integrationKey: string, fieldKey: string): string {
    return `integration.${integrationKey}.${fieldKey}`;
  }

  /** Mask a sensitive value — show only last 4 chars. */
  private mask(value: string): string {
    if (!value) return '';
    if (value.length <= 4) return '••••';
    return `••••${value.slice(-4)}`;
  }

  /**
   * C2 — Detect a value that looks like a mask round-trip from the UI.
   * GET returns `••••abcd`; if the user doesn't edit the field, the same
   * mask is POSTed back on save. We must NOT persist that literal — it
   * would corrupt the real secret. Treat any value that contains the
   * mask bullet `•` as "unchanged" and skip the write for that key.
   *
   * Public so service callers (e.g. specialized integration controllers)
   * can apply the same guard before invoking saveConfig.
   */
  isMaskedValue(value: string | undefined | null): boolean {
    if (!value) return false;
    return value.includes('•');
  }

  /**
   * Turn a stored value back into plaintext. Plaintext rows (saved while no key
   * was configured) pass through unchanged. Never throws and never returns
   * ciphertext — callers decide what "unreadable" means for them.
   */
  private readStored(raw: string): StoredRead {
    if (!isEncrypted(raw)) return { ok: true, value: raw };
    const { status, key } = this.resolveKey();
    if (status === 'missing') return { ok: false, reason: 'key-missing' };
    if (status === 'malformed') return { ok: false, reason: 'key-invalid' };
    try {
      return { ok: true, value: decryptPII(raw, key) };
    } catch {
      return { ok: false, reason: 'decrypt-failed' };
    }
  }

  /** Warn about an unreadable credential — field reference only, never the value. */
  private reportUndecryptable(fieldRef: string, reason: UndecryptableReason): void {
    const now = Date.now();
    const last = this.undecryptableWarnedAt.get(fieldRef);
    if (
      last !== undefined &&
      now - last < IntegrationConfigService.UNDECRYPTABLE_WARN_INTERVAL_MS
    ) {
      return;
    }
    this.undecryptableWarnedAt.set(fieldRef, now);
    this.logger.warn(
      `[IntegrationConfig] ${fieldRef} is stored encrypted but cannot be decrypted (${reason}) — treated as not configured; re-enter it in Integration Hub`,
    );
    Sentry.captureMessage('Integration credential cannot be decrypted', {
      level: 'warning',
      tags: { subsystem: 'integration-config', reason },
      extra: { field: fieldRef },
    });
  }

  /** Check if cached entry is still fresh. */
  private getCached(integrationKey: string): IntegrationConfig | null {
    const entry = this.cache.get(integrationKey);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > IntegrationConfigService.CACHE_TTL_MS) {
      this.cache.delete(integrationKey);
      return null;
    }
    return entry.config;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Read a single field value.
   * Priority: SystemConfig DB (decrypted) → env var → field defaultValue.
   *
   * A DB value that is encrypted but cannot be decrypted here (no key, wrong
   * key, malformed key) returns `undefined` = "not configured" — never the
   * ciphertext and never a throw into business code.
   */
  async getValue(integrationKey: string, fieldKey: string): Promise<string | undefined> {
    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const field = def.fields.find((f) => f.key === fieldKey);
    if (!field) throw new NotFoundException(`Field '${fieldKey}' not found in '${integrationKey}'`);

    // 1. DB
    const record = await this.prisma.systemConfig.findFirst({
      where: { key: this.dbKey(integrationKey, fieldKey), deletedAt: null },
    });

    if (record?.value) {
      const read = this.readStored(record.value);
      if (read.ok) return read.value;
      // Fail closed WITHOUT falling back to the env var: a DB row is the
      // admin's explicit override of the env value, and we cannot tell whether
      // env still holds the same credential (prod env LINE_CHANNEL_* may belong
      // to another / older OA). Using it would verify webhooks or send as an
      // account the admin replaced. "Not configured" stops the feature visibly;
      // the boot self-check names the field so it can be re-entered.
      this.reportUndecryptable(`${integrationKey}.${fieldKey}`, read.reason);
      return undefined;
    }

    // 2. Env var
    const envValue = process.env[field.envVar];
    if (envValue) return envValue;

    // 3. Default
    return field.defaultValue;
  }

  /**
   * Try to decrypt every encrypted sensitive credential stored in SystemConfig
   * (optionally for one integration) with the key this process holds.
   * Plaintext and empty rows are not listed.
   */
  async checkEncryptedFields(integrationKey?: string): Promise<EncryptedFieldCheck> {
    const refs = new Map<string, string>(); // SystemConfig key → integrationKey.fieldKey
    for (const def of INTEGRATIONS) {
      if (integrationKey && def.key !== integrationKey) continue;
      for (const field of def.fields) {
        if (field.sensitive) refs.set(this.dbKey(def.key, field.key), `${def.key}.${field.key}`);
      }
    }
    const { status } = this.resolveKey();
    if (refs.size === 0) return { key: status, ok: [], failed: [] };

    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: [...refs.keys()] }, deletedAt: null },
      select: { key: true, value: true },
    });
    const ok: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      const ref = refs.get(row.key);
      if (!ref || !row.value || !isEncrypted(row.value)) continue;
      (this.readStored(row.value).ok ? ok : failed).push(ref);
    }
    return { key: status, ok: ok.sort(), failed: failed.sort() };
  }

  /**
   * Get all field values for an integration (plaintext).
   */
  async getConfig(integrationKey: string): Promise<IntegrationConfig> {
    // Check cache first
    const cached = this.getCached(integrationKey);
    if (cached) return cached;

    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const result: IntegrationConfig = {};
    for (const field of def.fields) {
      const value = await this.getValue(integrationKey, field.key);
      result[field.key] = value ?? '';
    }

    // Store in cache
    this.cache.set(integrationKey, { config: result, cachedAt: Date.now() });
    return result;
  }

  /**
   * Get all field values for an integration with sensitive values masked.
   * Sensitive fields show `••••{last4}` instead of the real value.
   */
  async getMaskedConfig(integrationKey: string): Promise<MaskedIntegrationConfig> {
    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const result: MaskedIntegrationConfig = {};
    for (const field of def.fields) {
      const value = await this.getValue(integrationKey, field.key);
      result[field.key] = field.sensitive ? this.mask(value ?? '') : (value ?? '');
    }
    return result;
  }

  /**
   * Save config values for an integration.
   * Sensitive values are encrypted before storage.
   * Uses upsert on the unique `key` column.
   */
  async saveConfig(integrationKey: string, values: IntegrationConfig): Promise<void> {
    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const encKey = this.encryptionKey;

    for (const [fieldKey, rawValue] of Object.entries(values)) {
      const field = def.fields.find((f) => f.key === fieldKey);
      if (!field) {
        this.logger.warn(
          `Ignoring unknown field '${fieldKey}' for integration '${integrationKey}'`,
        );
        continue;
      }

      // C2 — Round-trip mask guard. The UI hydrates the form from
      // getMaskedConfig() and naïvely POSTs the form back on save, which
      // would persist `••••abcd` literally and corrupt the stored secret.
      // For any sensitive field whose incoming value still contains the
      // mask bullet, skip the write — preserves the original ciphertext.
      if (field.sensitive && this.isMaskedValue(rawValue)) {
        this.logger.debug(
          `Skipping masked round-trip for '${integrationKey}.${fieldKey}' — value unchanged`,
        );
        continue;
      }

      const dbKeyStr = this.dbKey(integrationKey, fieldKey);
      const storedValue =
        field.sensitive && encKey && rawValue ? encryptPII(rawValue, encKey) : rawValue;

      await this.prisma.systemConfig.upsert({
        where: { key: dbKeyStr },
        create: {
          key: dbKeyStr,
          value: storedValue,
          label: `${def.name} — ${field.label}`,
        },
        update: {
          value: storedValue,
          deletedAt: null, // restore if previously soft-deleted
        },
      });
    }

    this.logger.log(`Saved config for integration '${integrationKey}'`);
    // Invalidate cache so next read picks up new values
    this.cache.delete(integrationKey);
  }

  /**
   * Soft-delete all SystemConfig records for an integration.
   */
  async deleteConfig(integrationKey: string): Promise<void> {
    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const prefix = `integration.${integrationKey}.`;

    await this.prisma.systemConfig.updateMany({
      where: {
        key: { startsWith: prefix },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Deleted config for integration '${integrationKey}'`);
    this.cache.delete(integrationKey);
  }

  /**
   * Check whether all required fields for an integration have a value
   * (from DB, env, or default).
   */
  async isConfigured(integrationKey: string): Promise<boolean> {
    const def = getIntegrationDef(integrationKey);
    if (!def) return false;

    for (const field of def.fields) {
      if (!field.required) continue;
      const value = await this.getValue(integrationKey, field.key);
      if (!value) return false;
    }
    return true;
  }

  /**
   * Return a summary of all integrations with their configured status.
   * Useful for a dashboard listing.
   */
  async getAllStatus(): Promise<Array<{ key: string; name: string; configured: boolean }>> {
    return Promise.all(
      INTEGRATIONS.map(async (def) => ({
        key: def.key,
        name: def.name,
        configured: await this.isConfigured(def.key),
      })),
    );
  }
}
