import { Injectable } from '@nestjs/common';

/**
 * Stub for T5 — real implementation lands in T6.
 * Provides class symbol so OtherIncomeService DI compiles.
 */
@Injectable()
export class OtherIncomeTemplate {
  async post(): Promise<{ id: string; entryNumber: string }> {
    throw new Error('OtherIncomeTemplate.post() not implemented (T6)');
  }
}
