import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

export interface PeakExportResult {
  exported: number;
  skipped: number;
  errors: string[];
}

interface PeakConfig {
  baseUrl: string;
  userToken: string;
  connectId: string;
  secretKey: string;
}

/**
 * PEAK Accounting Sync Service
 *
 * API Docs: https://developers.peakaccount.com/reference/peak-open-api
 * Base URL: https://api.peakaccount.com/api/v1
 *
 * Authentication flow:
 * 1. Create Time-Stamp (yyyyMMddHHmmss)
 * 2. HMAC-SHA1(Time-Stamp, connectId) using secretKey → Time-Signature
 * 3. POST /ClientToken → get Client-Token
 * 4. Include all 4 headers on every request
 *
 * Key endpoint: POST /DailyJournals — create journal entries
 * Account codes already match PEAK XX-XXXX format.
 */
@Injectable()
export class PeakService {
  private readonly logger = new Logger(PeakService.name);
  private clientToken: string | null = null;
  private clientTokenExpiresAt: number = 0;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  /** Check if PEAK integration is configured */
  async isConfigured(): Promise<boolean> {
    const config = await this.getConfig();
    return !!(config.userToken && config.connectId && config.secretKey);
  }

  async getStatus(): Promise<{ configured: boolean; baseUrl: string; message: string }> {
    const config = await this.getConfig();
    const configured = await this.isConfigured();
    return {
      configured,
      baseUrl: config.baseUrl,
      message: configured
        ? 'PEAK เชื่อมต่อแล้ว'
        : 'ยังไม่ได้ตั้งค่า — ต้องการ PEAK_USER_TOKEN, PEAK_CONNECT_ID, PEAK_SECRET_KEY',
    };
  }

  /**
   * Export journal entries to PEAK for a given period.
   * Maps JournalEntry → POST /DailyJournals
   */
  async exportJournalEntries(startDate: Date, endDate: Date): Promise<PeakExportResult> {
    if (!(await this.isConfigured())) {
      return { exported: 0, skipped: 0, errors: ['PEAK ยังไม่ได้ตั้งค่า'] };
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        entryDate: { gte: startDate, lte: endDate },
        deletedAt: null,
        peakSyncedAt: null,
      },
      include: {
        lines: true,
        company: { select: { nameTh: true } },
      },
      orderBy: { entryDate: 'asc' },
    });

    if (entries.length === 0) {
      return { exported: 0, skipped: 0, errors: [] };
    }

    let exported = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      try {
        const peakPayload = this.mapJournalToPeak(entry);
        const result = await this.postToPeak('/DailyJournals', peakPayload);

        if (result.resCode === '200') {
          await this.prisma.journalEntry.update({
            where: { id: entry.id },
            data: { peakSyncedAt: new Date() },
          });
          exported++;
        } else {
          errors.push(`${entry.entryNumber}: ${result.resDesc || 'Unknown PEAK error'}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.entryNumber}: ${msg}`);
        Sentry.captureException(err, {
          tags: { kind: 'peak-sync', entryNumber: entry.entryNumber },
        });
      }
    }

    this.logger.log(`PEAK export: ${exported} exported, ${errors.length} errors out of ${entries.length}`);
    return { exported, skipped: entries.length - exported - errors.length, errors };
  }

  /** Fetch chart of accounts from PEAK */
  async getAccountCodes(): Promise<unknown> {
    if (!(await this.isConfigured())) return { error: 'PEAK ยังไม่ได้ตั้งค่า' };
    return this.getFromPeak('/DailyJournals/AccountCode');
  }

  // ─── PEAK API Communication ──────────────────────────────

  private async getConfig(): Promise<PeakConfig> {
    return {
      baseUrl: (await this.integrationConfig.getValue('peak', 'baseUrl')) || 'https://api.peakaccount.com/api/v1',
      userToken: (await this.integrationConfig.getValue('peak', 'userToken')) || '',
      connectId: (await this.integrationConfig.getValue('peak', 'connectId')) || '',
      secretKey: (await this.integrationConfig.getValue('peak', 'secretKey')) || '',
    };
  }

  /** Generate Time-Stamp in yyyyMMddHHmmss format */
  private generateTimeStamp(): string {
    const now = new Date();
    const y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${y}${M}${d}${h}${m}${s}`;
  }

  /** HMAC-SHA1(timeStamp, connectId) using secretKey → Time-Signature */
  private generateTimeSignature(timeStamp: string, config: PeakConfig): string {
    return createHmac('sha1', config.connectId)
      .update(timeStamp)
      .digest('hex');
  }

  /** Build auth headers for PEAK API */
  private async buildHeaders(): Promise<Record<string, string>> {
    const config = await this.getConfig();
    const timeStamp = this.generateTimeStamp();
    const timeSignature = this.generateTimeSignature(timeStamp, config);

    // Get or refresh Client-Token
    const clientToken = await this.ensureClientToken(timeStamp, timeSignature, config);

    return {
      'Content-Type': 'application/json',
      'Time-Stamp': timeStamp,
      'Time-Signature': timeSignature,
      'User-Token': config.userToken,
      'Client-Token': clientToken,
    };
  }

  /** Ensure Client-Token is valid, refresh if expired */
  private async ensureClientToken(
    timeStamp: string,
    timeSignature: string,
    config: PeakConfig,
  ): Promise<string> {
    if (this.clientToken && Date.now() < this.clientTokenExpiresAt) {
      return this.clientToken;
    }

    const res = await fetch(`${config.baseUrl}/ClientToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Time-Stamp': timeStamp,
        'Time-Signature': timeSignature,
        'User-Token': config.userToken,
      },
    });

    if (!res.ok) {
      throw new Error(`PEAK ClientToken failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    this.clientToken = body.clientToken || body.ClientToken || '';
    // Cache for 50 minutes (PEAK tokens typically last 1 hour)
    this.clientTokenExpiresAt = Date.now() + 50 * 60 * 1000;

    return this.clientToken!;
  }

  /** POST to PEAK API */
  private async postToPeak(path: string, body: unknown): Promise<{ resCode: string; resDesc: string; [key: string]: unknown }> {
    const config = await this.getConfig();
    const headers = await this.buildHeaders();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      return data as { resCode: string; resDesc: string };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('PEAK API timeout (15s)');
      }
      throw err;
    }
  }

  /** GET from PEAK API */
  private async getFromPeak(path: string): Promise<unknown> {
    const config = await this.getConfig();
    const headers = await this.buildHeaders();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      return res.json();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('PEAK API timeout (15s)');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Mapping ─────────────────────────────────────────────

  /** Map BESTCHOICE JournalEntry → PEAK DailyJournal payload */
  private mapJournalToPeak(entry: {
    entryNumber: string;
    entryDate: Date;
    description: string;
    lines: Array<{ accountCode: string; description: string | null; debit: { toString(): string }; credit: { toString(): string } }>;
  }): Record<string, unknown> {
    const issuedDate = entry.entryDate.toISOString().split('T')[0]; // YYYY-MM-DD

    return {
      code: entry.entryNumber,
      issuedDate,
      reference: entry.entryNumber,
      remarks: entry.description,
      items: entry.lines.map((line) => ({
        accountCode: line.accountCode, // Already XX-XXXX format
        description: line.description || entry.description,
        debitAmount: parseFloat(line.debit.toString()),
        creditAmount: parseFloat(line.credit.toString()),
      })),
    };
  }
}
