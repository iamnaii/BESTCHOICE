import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { glContractBalance } from '../gl-contract-balance';

/**
 * Exchange A.5 — ECL allowance reversal on derecognition (Device Swap 2026-07).
 *
 * TFRS 9 ฯ 5.5.8: derecognize สัญญา → reverse ค่าเผื่อฯ ของสัญญานั้น.
 * Workbook Case 4 originally proposed Cr 42-1106 (owner decision D2, 2026-07-29),
 * but CPA ruling 2026-08-01 (spec §13 A2.2, คำตอบ ข) chose ONE standard release
 * account across every path — Cr 51-1103 (ค่าเผื่อหนี้สงสัยจะสูญ เพิ่มในปี),
 * same account `EclStageReverseTemplate`/JP5/write-off already use. 42-1106 was
 * subsequently REMOVED from the CoA entirely (CPA/owner 2026-08-03) — it never
 * carried a single journal line.
 *
 *   Dr 11-2102 [GL balance ของสัญญาเก่า]
 *     Cr 51-1103 [เท่ากัน]
 *
 * เรียก synchronous ใน activation tx (workbook: "ถ้า error → swap rollback ทั้งหมด").
 * Null cases: GL = 0 (ไม่มี provision) / GL < 0 (anomaly → Sentry warning, ไม่ auto-heal — M1 pattern)
 */
@Injectable()
export class ExchangeEclReversalTemplate {
  private readonly logger = new Logger(ExchangeEclReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: {
      oldContractId: string;
      /**
       * ContractExchangeRequest.id — part of the idempotency key (C1b, final
       * review 2026-07-29): a canceled swap's still-POSTED A.5 must not block
       * the same contract's second exchange attempt.
       */
      requestId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string } | null> {
    const client = tx ?? this.prisma;
    const balance = await glContractBalance(client, input.oldContractId, '11-2102', 'cr');

    if (balance.lt(0)) {
      Sentry.captureMessage('Exchange A.5: negative 11-2102 balance — manual investigation required', {
        level: 'warning',
        tags: { subsystem: 'bad-debt' },
        extra: { contractId: input.oldContractId, balance: balance.toString() },
      });
      this.logger.warn(
        `A.5 skipped — negative 11-2102 balance ${balance.toString()} (contract ${input.oldContractId})`,
      );
      return null;
    }
    if (balance.lt('0.005')) {
      return null; // ไม่มี provision — ไม่ต้อง post
    }

    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `Exchange A.5 — reverse ECL allowance on derecognition (สัญญา ${input.oldContractId.slice(0, 8)})`,
        metadata: {
          tag: 'EXCHANGE-ECL-REVERSAL',
          flow: 'exchange-ecl-reversal',
          idempotencyKey: `${input.oldContractId}:${input.requestId}`,
          contractId: input.oldContractId,
          reversedProvision: balance.toFixed(2),
        },
        lines: [
          {
            accountCode: '11-2102',
            dr: balance,
            cr: zero,
            description: 'กลับค่าเผื่อหนี้สงสัยจะสูญ — derecognize จากเปลี่ยนเครื่อง (TFRS 9 ฯ 5.5.8)',
          },
          {
            accountCode: '51-1103',
            dr: zero,
            cr: balance,
            description: 'โอนกลับค่าเผื่อหนี้สงสัยจะสูญ — ลดค่าใช้จ่าย (มาตรฐานเดียว CPA 2026-08-01)',
          },
        ],
      },
      tx,
    );
  }
}
