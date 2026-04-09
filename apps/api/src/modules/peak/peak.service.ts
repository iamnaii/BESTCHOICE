import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface PeakExportResult {
  exported: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class PeakService {
  private readonly logger = new Logger(PeakService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /** Check if PEAK integration is configured */
  isConfigured(): boolean {
    return !!(
      this.configService.get('PEAK_API_KEY') &&
      this.configService.get('PEAK_API_SECRET')
    );
  }

  /**
   * Export journal entries to PEAK for a given period.
   * Currently a scaffold — returns skipped until API credentials are provided.
   */
  async exportJournalEntries(startDate: Date, endDate: Date): Promise<PeakExportResult> {
    if (!this.isConfigured()) {
      this.logger.warn('PEAK integration not configured — set PEAK_API_KEY and PEAK_API_SECRET');
      return { exported: 0, skipped: 0, errors: ['PEAK not configured'] };
    }

    // TODO: Implement when PEAK API credentials are available
    // 1. Query posted journal entries in date range
    // 2. Map to PEAK API format (account codes already follow PEAK XX-XXXX format)
    // 3. POST to PEAK API endpoint
    // 4. Mark entries as synced (peakSyncedAt timestamp)
    //    — requires adding `peakSyncedAt DateTime?` field to JournalEntry model

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        entryDate: { gte: startDate, lte: endDate },
        deletedAt: null,
        // peakSyncedAt: null, // uncomment when field is added to schema
      },
      include: { lines: true },
    });

    this.logger.log(`Found ${entries.length} journal entries to export to PEAK (export pending)`);

    return {
      exported: 0,
      skipped: entries.length,
      errors: ['PEAK API integration pending — awaiting credentials'],
    };
  }

  /**
   * Map a BESTCHOICE account code to PEAK format.
   * Account codes already follow PEAK XX-XXXX convention, so no transformation is needed.
   */
  mapAccountCode(code: string): string {
    // Account codes already follow PEAK XX-XXXX format (e.g. 11-1101, 41-1101)
    return code;
  }
}
