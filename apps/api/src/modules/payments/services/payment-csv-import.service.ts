import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentCase } from '../dto/payment.dto';
import { CASH_ACCOUNT_CODES, type CashAccountCode } from '../dto/csv-import.dto';

/**
 * Host the CSV importer delegates each row to. Implemented by the facade so the
 * row-by-row `recordPayment` call resolves through the facade's spyable surface
 * (csv-import.spec + C6 idempotency spec spy `service.recordPayment`). Same
 * signature as PaymentsService.recordPayment.
 */
export interface PaymentCsvImportHost {
  recordPayment(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    evidenceUrl?: string,
    notes?: string,
    transactionRef?: string,
    depositAccountCode?: string,
    toleranceApproverId?: string,
    paymentCase?: PaymentCase,
  ): Promise<unknown>;
}

/**
 * Batch CSV payment importer. Parses a header-skipped CSV, validates each row,
 * and delegates the money math row-by-row to the host's recordPayment (so each
 * row gets the full Serializable money $tx — the importer itself opens NO
 * transaction). Body moved VERBATIM from the legacy PaymentsService.
 *
 * Constructed internally by PaymentsService.
 */
@Injectable()
export class PaymentCsvImportService {
  private readonly logger = new Logger('PaymentsService');

  constructor(
    private prisma: PrismaService,
    private host: PaymentCsvImportHost,
  ) {}

  /** Parse a single CSV line handling quoted fields (e.g., "value with, comma") */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'; // escaped quote
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ─── Batch CSV Payment Import ────────────────────────
  /**
   * Parse CSV and record payments in batch.
   * Expected CSV format:
   *   contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes,depositAccountCode
   * Last column (depositAccountCode) is optional; falls back to body-level
   * dto.depositAccountCode → user defaultCashAccountCode → 11-1101.
   * First row is header (skipped).
   */
  async importPaymentsFromCsv(
    csvText: string,
    defaultPaymentMethod: string,
    recordedById: string,
    bodyDepositAccountCode?: string,
  ): Promise<{ total: number; success: number; errors: { row: number; message: string }[] }> {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new BadRequestException('CSV ต้องมีอย่างน้อย 1 แถวข้อมูล (ไม่รวม header)');
    }

    // Skip header row
    const dataRows = lines.slice(1);
    const errors: { row: number; message: string }[] = [];
    let success = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = i + 2; // 1-indexed, +1 for header
      const line = dataRows[i].trim();
      if (!line) continue;

      // Parse CSV with proper quoted-field handling (handles commas inside quotes)
      const cols = this.parseCsvLine(line);
      if (cols.length < 3) {
        errors.push({ row, message: 'ข้อมูลไม่ครบ ต้องมีอย่างน้อย contractNumber, installmentNo, amount' });
        continue;
      }

      const [
        contractNumber,
        installmentNoStr,
        amountStr,
        paymentMethod,
        transactionRef,
        notes,
        rowDepositAccountCode,
      ] = cols;
      const installmentNo = parseInt(installmentNoStr, 10);
      const amount = parseFloat(amountStr);

      if (!contractNumber || isNaN(installmentNo) || isNaN(amount) || amount <= 0) {
        errors.push({ row, message: `ข้อมูลไม่ถูกต้อง: contractNumber=${contractNumber}, installmentNo=${installmentNoStr}, amount=${amountStr}` });
        continue;
      }

      // Per-row deposit account: row column > body default > recordPayment fallback
      const depositCode = rowDepositAccountCode?.trim() || bodyDepositAccountCode;
      if (depositCode && !CASH_ACCOUNT_CODES.includes(depositCode as CashAccountCode)) {
        errors.push({
          row,
          message: `บัญชีรับเงินไม่ถูกต้อง: ${depositCode} (รหัสที่อนุญาต: ${CASH_ACCOUNT_CODES.join(', ')})`,
        });
        continue;
      }

      try {
        // Lookup contract by number
        const contract = await this.prisma.contract.findFirst({
          where: { contractNumber, deletedAt: null },
          select: { id: true },
        });
        if (!contract) {
          errors.push({ row, message: `ไม่พบสัญญา ${contractNumber}` });
          continue;
        }

        // C6 fix: CSV idempotency. The previous synthetic
        // `CSV-${Date.now()}-${row}-${Math.random()}` was unique every run, so
        // re-importing the same CSV (e.g. operator retry after partial failure)
        // created duplicate Payments + duplicate JEs. Replace with a
        // content-stable SHA-256 hash of the row's business identity:
        //   contractNumber | installmentNo | amount | paidDate (date-only).
        // Re-importing the same row will compute the same ref, and the
        // existing idempotency check in recordPayment (notes contains
        // `ref:<value>`) will reject it as a duplicate.
        //
        // Round 2 C6 fix: date component MUST be Asia/Bangkok local date.
        // `new Date().toISOString().slice(0, 10)` returns UTC, so a CSV
        // imported at 01:00 BKK (= 18:00 UTC previous day) hashes as
        // yesterday — losing idempotency for ~7 hours every night when the
        // operator retries spanning UTC midnight. en-CA `Intl.DateTimeFormat`
        // outputs `YYYY-MM-DD` in the chosen timeZone (matches getBkkYyyymm
        // pattern from PR #840).
        const bkkDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Bangkok',
        }).format(new Date());
        const stableRef =
          transactionRef ||
          `csv:${createHash('sha256')
            .update(
              [
                contractNumber,
                String(installmentNo),
                amount.toFixed(2),
                bkkDate,
              ].join('|'),
            )
            .digest('hex')
            .slice(0, 32)}`;

        await this.host.recordPayment(
          contract.id,
          installmentNo,
          amount,
          paymentMethod || defaultPaymentMethod,
          recordedById,
          undefined, // evidenceUrl
          notes || `CSV import row ${row}`,
          stableRef,
          depositCode, // resolves to user default → 11-1101 if undefined
        );
        success++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ row, message });
      }
    }

    this.logger.log(`CSV payment import: ${success} success, ${errors.length} errors out of ${dataRows.length} rows`);
    return { total: dataRows.length, success, errors };
  }
}
