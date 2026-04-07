/**
 * ⚠️ TEMPORARY ENDPOINT — Legacy data migration from โปรแกรมเขียว
 *
 * Single-use admin endpoint to wipe customer data + import from CSV.
 * Protected by LEGACY_IMPORT_SECRET env var (constant-time compare).
 *
 * Flow: POST /api/legacy-import/execute (Bearer token)
 *   1. Wipe customer-related tables
 *   2. Run import script logic
 *   3. Return JSON report
 *
 * After successful production migration: DELETE this entire module.
 */
import { Controller, Post, Get, Headers, UnauthorizedException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { Public } from '../auth/decorators/public.decorator';

let runningJob: { startedAt: Date; phase: string; logs: string[]; done: boolean; error?: string } | null = null;

@Controller('legacy-import')
export class LegacyImportController {
  private readonly logger = new Logger('LegacyImport');

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
    return runningJob || { idle: true };
  }

  @Public()
  @Post('execute')
  async execute(@Headers('authorization') auth?: string) {
    this.checkAuth(auth);

    if (runningJob && !runningJob.done) {
      return { error: 'Job already running', startedAt: runningJob.startedAt, phase: runningJob.phase };
    }

    runningJob = { startedAt: new Date(), phase: 'starting', logs: [], done: false };
    this.logger.warn('🔴 Legacy import job triggered');

    // Run as background subprocess so HTTP doesn't timeout (Cloud Run 60s limit)
    // Sequence: wipe → import → validate
    runJob().catch((e) => {
      this.logger.error('Job failed', e);
      if (runningJob) {
        runningJob.done = true;
        runningJob.error = e.message;
      }
    });

    return { ok: true, message: 'Job started in background. Poll GET /api/legacy-import/status' };
  }
}

async function runJob() {
  const scriptDir = resolve(__dirname, '../../../scripts/import-legacy');
  const phases = [
    { name: 'wipe', script: 'wipe-data.ts', args: ['--confirm-wipe'] },
    { name: 'import', script: 'index.ts', args: [] },
    { name: 'validate', script: 'validate.ts', args: [] },
  ];

  for (const phase of phases) {
    if (!runningJob) return;
    runningJob.phase = phase.name;
    runningJob.logs.push(`\n═══ ${phase.name.toUpperCase()} ═══`);

    await new Promise<void>((resolveP, rejectP) => {
      const proc = spawn('npx', ['tsx', `${scriptDir}/${phase.script}`, ...phase.args], {
        cwd: resolve(__dirname, '../../..'),
        env: process.env,
        shell: true,
      });
      proc.stdout.on('data', (d) => runningJob?.logs.push(d.toString()));
      proc.stderr.on('data', (d) => runningJob?.logs.push('[stderr] ' + d.toString()));
      proc.on('close', (code) => (code === 0 ? resolveP() : rejectP(new Error(`${phase.name} exited with code ${code}`))));
      proc.on('error', rejectP);
    });
  }

  if (runningJob) {
    runningJob.phase = 'done';
    runningJob.done = true;
  }
}
