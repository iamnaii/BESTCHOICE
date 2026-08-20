import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Redirect ของ mirror leg หนึ่งบัญชี (Phase 3 — Flow C ยกเลิกสัญญา):
 * แทนที่จะ mirror กลับเข้าบัญชีเดิม ให้ยอด mirror (dr↔cr สลับแล้ว)
 * ไปลงบัญชีปลายทางแทน เช่น 21-1101 → 11-2107 (PAYOUT_RECALL).
 */
export interface SweepRedirect {
  /** บัญชีปลายทางของ mirror leg (เช่น 21-1101 → 11-2107) */
  to: string;
  /** description ของ leg ที่ redirect */
  description: string;
}

export interface CancelSweepInput {
  jeIds: string[];
  /** ชื่อเดิมคงไว้ — คือ contractId ที่ใช้ sweep (exchange ส่ง newContractId, generic ส่ง contractId) */
  newContractId: string;
  /** flows ที่ห้าม mirror (default [] — พฤติกรรม exchange เดิมไม่เปลี่ยน) */
  excludeFlows?: string[];
  /** map บัญชี → redirect ปลายทาง ใช้ใน C-2 (default undefined = mirror ตรง) */
  redirects?: Record<string, SweepRedirect>;
  /** stamp เพิ่มบน reversal JE ที่มี redirect leg (เช่น shopReceivableType: 'PAYOUT_RECALL') */
  redirectStamp?: Record<string, string>;
  /** flow/label ของ reversal (default 'exchange-cancel' + prefix '[ยกเลิกเปลี่ยนเครื่อง]') */
  flowLabel?: string;
  descriptionPrefix?: string;
}

/**
 * Device Swap 2026-07 — ยกเลิก swap (workbook Cases 3A/3B, spec §9).
 * Mirror-reverse ทุกบรรทัด (Corrective Control C1 — ห้ามแก้ JE เดิม):
 *   1. JE ตาม ids ที่ request บันทึกไว้ (A.1/A.2/A.3/A.4/A.5) — แม่นกว่า metadata sweep
 *   2. sweep JE อื่นที่ tag metadata.contractId = newContractId (เช่น 2A accrual
 *      ที่วิ่งบนสัญญาใหม่ระหว่าง window) — ยกเว้น payment flows (ถูก guard บล็อกก่อนแล้ว)
 * Mirror ต้อง copy companyId (A.4 = SHOP!) + metadata.contractId เดิม เพื่อให้
 * glContractBalance net เป็น 0 ทุกบัญชีทุกสัญญา
 *
 * Phase 3 (Flow C — ยกเลิกสัญญา): engine ถูก generalize ด้วย options ใหม่ทั้งหมด
 * (excludeFlows / redirects / redirectStamp / flowLabel / descriptionPrefix) —
 * caller เดิมที่ส่ง `{ jeIds, newContractId }` ได้พฤติกรรมเดิมทุก byte
 * (flow 'exchange-cancel', idempotencyKey `cancel:<jeId>`, prefix
 * '[ยกเลิกเปลี่ยนเครื่อง]'). `redirectedTotals` คืน Σ(Dr−Cr) ของ mirror legs
 * ที่ถูก redirect เข้าแต่ละบัญชีปลายทาง — caller ใช้ cross-check กับ GL.
 */
@Injectable()
export class ExchangeCancelReversalTemplate {
  private readonly logger = new Logger(ExchangeCancelReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async reverse(
    input: CancelSweepInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversalJeIds: string[]; redirectedTotals: Record<string, Decimal> }> {
    const client = tx ?? this.prisma;
    const flowLabel = input.flowLabel ?? 'exchange-cancel';
    // ระวัง back-compat: exchange เดิมใช้ idempotencyKey `cancel:<jeId>` — default
    // prefix จึงเป็น 'cancel' (ไม่ใช่ flowLabel ที่ resolve แล้ว) เมื่อไม่ส่ง flowLabel
    const idemPrefix = input.flowLabel ?? 'cancel';
    const descriptionPrefix = input.descriptionPrefix ?? '[ยกเลิกเปลี่ยนเครื่อง]';

    const byId = await client.journalEntry.findMany({
      where: { id: { in: input.jeIds }, status: 'POSTED', deletedAt: null },
      include: { lines: true },
    });
    const swept = await client.journalEntry.findMany({
      where: {
        metadata: { path: ['contractId'], equals: input.newContractId } as any,
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });
    const all = new Map<string, (typeof byId)[number]>();
    for (const je of [...byId, ...swept]) all.set(je.id, je);

    const reversalJeIds: string[] = [];
    const redirectedTotals: Record<string, Decimal> = {};
    for (const je of all.values()) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;
      if (meta['reversed'] === true) continue;
      if (meta['flow'] === flowLabel) continue; // reversal ของตัวเองที่ sweep เจอ
      if (input.excludeFlows?.includes(meta['flow'] as string)) continue;
      // Reversal JEs (เช่น receipt-void) กับ original ที่ถูก stamp reversed:true
      // หักล้างกันเป็นคู่ใน GL อยู่แล้ว — ข้ามทั้งคู่คือถูกต้อง; mirror ข้างใดข้างหนึ่ง
      // = re-post ผลของ original กลับเข้า GL โดยไม่มีเงินจริง (A.5 ของเราปลอดภัย:
      // ใช้ tag 'EXCHANGE-ECL-REVERSAL' ไม่ใช่ 'REVERSAL')
      if (meta['tag'] === 'REVERSAL') continue;
      if (je.lines.length === 0) continue;

      let hasRedirectLeg = false;
      const reversedLines = je.lines.map((l) => {
        const dr = new Decimal(l.credit.toString());
        const cr = new Decimal(l.debit.toString());
        const redirect = input.redirects?.[l.accountCode];
        if (redirect) {
          hasRedirectLeg = true;
          // Σ(Dr−Cr) ต่อบัญชีปลายทาง — คิดจาก mirror lines หลังสลับข้างแล้ว
          redirectedTotals[redirect.to] = (redirectedTotals[redirect.to] ?? new Decimal(0))
            .plus(dr)
            .minus(cr);
          return {
            accountCode: redirect.to,
            dr,
            cr,
            description: redirect.description,
          };
        }
        return {
          accountCode: l.accountCode,
          dr,
          cr,
          description: `${descriptionPrefix} ${l.description ?? ''}`.trim(),
        };
      });

      const result = await this.journal.createAndPost(
        {
          description: `${descriptionPrefix} กลับรายการ ${je.entryNumber}`,
          reference: `${je.id}:${flowLabel}`,
          companyId: je.companyId, // สำคัญ: A.4 เป็น SHOP company
          metadata: {
            tag: 'REVERSAL',
            flow: flowLabel,
            idempotencyKey: `${idemPrefix}:${je.id}`,
            originalEntryId: je.id,
            reversesEntryId: je.id,
            contractId: (meta['contractId'] as string | undefined) ?? undefined,
            // Carry the netting-lens type (final review 2026-08-19): a mirror
            // of a stamped JE (A.3/A.4 SWAP_CREDIT) must net against the same
            // type — otherwise the canceled swap leaves +SWAP_CREDIT/-UNKNOWN
            // pairs on 11-2107/S21-3001 and the Phase 2 per-type sum sees a
            // phantom balance while the real GL is 0.
            ...(meta['shopReceivableType']
              ? { shopReceivableType: meta['shopReceivableType'] as string }
              : {}),
            // Carry the SHOP-lens key (Phase 2 Task 1): S21-3001 is summed per
            // NEW contract — a mirror without it would leave a phantom
            // per-contract balance on a canceled swap while the real GL is 0.
            ...(typeof meta['newContractId'] === 'string'
              ? { newContractId: meta['newContractId'] }
              : {}),
            // Phase 3 (C-2): stamp เฉพาะ JE ที่มี redirect leg — วางท้ายสุดให้
            // ชนะค่า copy จาก JE เดิม (เช่น shopReceivableType → 'PAYOUT_RECALL')
            ...(hasRedirectLeg ? (input.redirectStamp ?? {}) : {}),
          },
          lines: reversedLines,
        },
        tx,
      );

      await client.journalEntry.update({
        where: { id: je.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });
      reversalJeIds.push(result.id);
    }
    this.logger.log(`Exchange cancel — reversed ${reversalJeIds.length} JE(s)`);
    return { reversalJeIds, redirectedTotals };
  }
}
