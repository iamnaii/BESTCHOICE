import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptPII, decryptPII, isEncrypted } from '../../utils/crypto.util';
import { getIntegrationDef, INTEGRATIONS } from './integration-registry';

/** Flat map of fieldKey → plaintext value for a single integration. */
export type IntegrationConfig = Record<string, string>;

/** Same shape but sensitive values are masked (e.g. `••••abcd`). */
export type MaskedIntegrationConfig = Record<string, string>;

@Injectable()
export class IntegrationConfigService {
  private readonly logger = new Logger(IntegrationConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** Return the encryption key from env; empty string if not set (no encryption). */
  private get encryptionKey(): string {
    return this.configService.get<string>('INTEGRATION_ENCRYPTION_KEY') ?? '';
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

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Read a single field value.
   * Priority: SystemConfig DB (decrypted) → env var → field defaultValue.
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
      const raw = record.value;
      const key = this.encryptionKey;
      return key && isEncrypted(raw) ? decryptPII(raw, key) : raw;
    }

    // 2. Env var
    const envValue = process.env[field.envVar];
    if (envValue) return envValue;

    // 3. Default
    return field.defaultValue;
  }

  /**
   * Get all field values for an integration (plaintext).
   */
  async getConfig(integrationKey: string): Promise<IntegrationConfig> {
    const def = getIntegrationDef(integrationKey);
    if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

    const result: IntegrationConfig = {};
    for (const field of def.fields) {
      const value = await this.getValue(integrationKey, field.key);
      result[field.key] = value ?? '';
    }
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
        this.logger.warn(`Ignoring unknown field '${fieldKey}' for integration '${integrationKey}'`);
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
