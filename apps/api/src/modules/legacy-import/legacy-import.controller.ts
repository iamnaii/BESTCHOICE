/**
 * ⚠️ TEMPORARY ENDPOINT — Legacy data migration from โปรแกรมเขียว
 * Protected by LEGACY_IMPORT_SECRET env var (constant-time compare).
 * Remove this whole module after successful production import.
 */
import { Controller, Post, Get, Headers, UnauthorizedException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { LegacyImportService } from './legacy-import.service';

@Controller('legacy-import')
export class LegacyImportController {
  private readonly logger = new Logger('LegacyImport');

  constructor(private readonly service: LegacyImportService) {}

  private checkAuth(authHeader?: string) {
    const expected = process.env.LEGACY_IMPORT_SECRET;
    if (!expected || expected.length < 16) {
      throw new ServiceUnavailableException('LEGACY_IMPORT_SECRET not configured');
    }
    const provided = authHeader?.replace(/^Bearer\s+/i, '') || '';
    const a = Buffer.from(provided.padEnd(64, '\0').slice(0, 64));
    const b = Buffer.from(expected.padEnd(64, '\0').slice(0, 64));
    if (!timingSafeEqual(a, b) || provided !== expected) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  @Public()
  @Get('status')
  status(@Headers('authorization') auth?: string) {
    this.checkAuth(auth);
    return this.service.getStatus();
  }

  @Public()
  @Post('execute')
  async execute(@Headers('authorization') auth?: string) {
    this.checkAuth(auth);

    if (this.service.isRunning()) {
      return { error: 'Job already running', status: this.service.getStatus() };
    }

    this.logger.warn('🔴 Legacy import job triggered');
    // Fire and forget — runs in background
    this.service.execute().catch((e) => this.logger.error('Job failed', e));

    return { ok: true, message: 'Job started in background. Poll GET /api/legacy-import/status' };
  }
}
