import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { warnIfVatKeysCollide } from './vat-rate.util';

/**
 * D1.1.3.1 — One-shot bootstrap warning for the VAT_RATE/vat_pct/vat_rate
 * orphan-key situation. Runs once per app boot, logs at WARN if both the
 * canonical and a legacy key are present, otherwise silent.
 *
 * Intentionally a tiny service rather than inline in AppModule:
 *   - Single responsibility, easy to unit-test
 *   - Keeps `app.module.ts` providers list focused on framework wiring
 *   - DB read failures swallow inside `warnIfVatKeysCollide` itself, so
 *     this can never block startup
 */
@Injectable()
export class VatRateBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(VatRateBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await warnIfVatKeysCollide(this.prisma);
    this.logger.debug('[D1.1.3.1] VAT_RATE orphan-key check complete');
  }
}
