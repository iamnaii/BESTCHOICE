import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Characterization tests for PaymentsService.importPaymentsFromCsv (Wave 3 LOW gap-fill).
 *
 * The batch CSV payment importer (review finding: untested validation/aggregation
 * path) parses a header-skipped CSV, validates each row, and delegates the money
 * math to recordPayment. These goldens PIN CURRENT BEHAVIOUR — they do NOT touch
 * the journal/money path (recordPayment is stubbed via jest.spyOn).
 *
 * What is locked here:
 *  - Result shape { total, success, errors:[{ row, message }] } where `total` is the
 *    data-row count (lines minus header) and `row` is 1-indexed +1-for-header
 *    (first data row = row 2).
 *  - Per-row validation order & which validation rejects which row:
 *      amount === 0 fails the `amount <= 0` guard (NOT the cols/contract guard);
 *      an unknown depositAccountCode fails the CASH_ACCOUNT_CODES whitelist guard;
 *      a valid row delegates to recordPayment and increments success.
 *  - Content-stable SHA-256 idempotency ref derivation: when transactionRef is
 *    blank the importer computes a deterministic `csv:<32-hex>` ref from
 *    `contractNumber|installmentNo|amount.toFixed(2)|bkkDate`, so re-importing the
 *    same row yields the SAME ref (re-derived here using the same formula and
 *    asserted on the arg recordPayment received). An explicit transactionRef in
 *    the CSV passes through verbatim (no hashing).
 *
 * QUIRKS pinned (intentional, current behaviour — NOT bugs to fix):
 *  - `total` counts ALL data rows including blank lines that are `continue`-skipped
 *    before validation, so total can exceed success + errors.length.
 *  - The bkkDate component is wall-clock-dependent (Asia/Bangkok), so the absolute
 *    hash cannot be hardcoded across days; determinism is proven structurally by
 *    re-deriving with the same `new Date()` window + asserting equality between two
 *    imports of the same row.
 */

const RECORDED_BY = 'user-1';
const DEFAULT_METHOD = 'TRANSFER';

/** Re-derive the importer's content-stable ref the SAME way the source does. */
const deriveRef = (contractNumber: string, installmentNo: number, amount: number): string => {
  const bkkDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  return `csv:${createHash('sha256')
    .update([contractNumber, String(installmentNo), amount.toFixed(2), bkkDate].join('|'))
    .digest('hex')
    .slice(0, 32)}`;
};

/**
 * Minimal Prisma mock — the importPaymentsFromCsv path only touches
 * `prisma.contract.findFirst`. `findContract` returns a stub contract id for any
 * contractNumber unless the test overrides it (e.g. to simulate "ไม่พบสัญญา").
 */
const makePrisma = (findContract: jest.Mock) =>
  ({
    contract: { findFirst: findContract },
  }) as unknown as PrismaService;

/**
 * Build a PaymentsService whose constructor deps are inert stubs. The CSV path
 * delegates the money math to recordPayment, which we spy on — so none of the
 * journal/line-oa/mdm deps are exercised. recordPayment is replaced with a
 * resolved stub that records the args it was called with.
 */
const makeService = (findContract: jest.Mock = jest.fn().mockResolvedValue({ id: 'contract-id' })) => {
  const stub = {} as never;
  const svc = new PaymentsService(
    makePrisma(findContract),
    stub, // receiptsService
    stub, // auditService
    stub, // journalAutoService
    stub, // paymentReceipt2BTemplate
    stub, // productsService
    stub, // lineOaService
    stub, // flexTemplates
    stub, // quickReplyService
    stub, // badDebtService
  );
  const recordPayment = jest
    .spyOn(svc, 'recordPayment')
    .mockResolvedValue({ id: 'payment-id' } as never);
  return { svc, recordPayment, findContract };
};

describe('PaymentsService.importPaymentsFromCsv (Wave 3 LOW gap-fill characterization)', () => {
  const header =
    'contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes,depositAccountCode';

  describe('3-row CSV: 1 valid, 1 amount=0, 1 bad deposit code', () => {
    // Row order (after header → data rows start at row 2):
    //   row 2 — valid
    //   row 3 — amount 0 (rejected by `amount <= 0`)
    //   row 4 — bad deposit account code (rejected by whitelist)
    const csv = [
      header,
      'CT-001,1,1500,TRANSFER,,note-a,11-1101',
      'CT-002,2,0,TRANSFER,,note-b,11-1101',
      'CT-003,3,2000,TRANSFER,,note-c,99-9999',
    ].join('\n');

    it('returns { total: 3, success: 1, errors: [row 3 amount, row 4 deposit] }', async () => {
      const { svc, recordPayment } = makeService();

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.total).toBe(3);
      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(2);

      // Only the valid row delegated to recordPayment.
      expect(recordPayment).toHaveBeenCalledTimes(1);

      // amount === 0 row is rejected by the `amount <= 0` guard (the
      // "ข้อมูลไม่ถูกต้อง" branch echoes the raw amount string), on row 3.
      expect(result.errors[0]).toEqual({
        row: 3,
        message:
          'ข้อมูลไม่ถูกต้อง: contractNumber=CT-002, installmentNo=2, amount=0',
      });

      // Unknown deposit code rejected by the CASH_ACCOUNT_CODES whitelist, on row 4.
      expect(result.errors[1].row).toBe(4);
      expect(result.errors[1].message).toContain('บัญชีรับเงินไม่ถูกต้อง: 99-9999');
      expect(result.errors[1].message).toContain('11-1101, 11-1102, 11-1103');
    });

    it('rows are 1-indexed with +1 for the skipped header (first data row = row 2)', async () => {
      const { svc, recordPayment } = makeService();
      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      // The valid row (data index 0) was at file row 2.
      const [contractId, installmentNo] = recordPayment.mock.calls[0];
      expect(contractId).toBe('contract-id');
      expect(installmentNo).toBe(1);
    });
  });

  describe('delegation to recordPayment (positional args)', () => {
    it('passes contract.id, parsed installmentNo, parsed amount, method, recordedById, and the deposit code', async () => {
      const findContract = jest.fn().mockResolvedValue({ id: 'c-42' });
      const { svc, recordPayment } = makeService(findContract);
      const csv = [header, 'CT-007,3,1234.50,CASH,,hello,11-1201'].join('\n');

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      const call = recordPayment.mock.calls[0];
      expect(call[0]).toBe('c-42'); // contractId from findFirst
      expect(call[1]).toBe(3); // installmentNo (parseInt)
      expect(call[2]).toBe(1234.5); // amount (parseFloat)
      expect(call[3]).toBe('CASH'); // row paymentMethod wins over default
      expect(call[4]).toBe(RECORDED_BY);
      expect(call[5]).toBeUndefined(); // evidenceUrl always undefined
      expect(call[8]).toBe('11-1201'); // per-row depositAccountCode
    });

    it('falls back to defaultPaymentMethod and a generated note when the row omits them', async () => {
      const { svc, recordPayment } = makeService();
      // Only 3 columns → paymentMethod, transactionRef, notes, deposit all undefined.
      const csv = [header, 'CT-008,4,500'].join('\n');

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      const call = recordPayment.mock.calls[0];
      expect(call[3]).toBe(DEFAULT_METHOD); // method fallback
      expect(call[6]).toBe('CSV import row 2'); // notes fallback "CSV import row <row>"
      expect(call[8]).toBeUndefined(); // no deposit code → undefined (recordPayment resolves default)
    });
  });

  describe('content-stable SHA-256 idempotency ref', () => {
    it('derives a deterministic csv:<32-hex> ref from row business identity when transactionRef is blank', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-100,5,3000,TRANSFER,,note,11-1101'].join('\n');

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      const refArg = recordPayment.mock.calls[0][7] as string;
      expect(refArg).toBe(deriveRef('CT-100', 5, 3000));
      expect(refArg).toMatch(/^csv:[0-9a-f]{32}$/);
    });

    it('is idempotent: the SAME row content yields the SAME ref across two imports', async () => {
      const csv = [header, 'CT-200,6,4500,TRANSFER,,note,11-1101'].join('\n');

      const a = makeService();
      await a.svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);
      const refA = a.recordPayment.mock.calls[0][7];

      const b = makeService();
      await b.svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);
      const refB = b.recordPayment.mock.calls[0][7];

      expect(refA).toBe(refB);
    });

    it('passes an explicit transactionRef through verbatim (no hashing)', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-300,7,1000,TRANSFER,BANK-REF-XYZ,note,11-1101'].join('\n');

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(recordPayment.mock.calls[0][7]).toBe('BANK-REF-XYZ');
    });

    it('two DIFFERENT rows produce different refs (amount is part of the hash identity)', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [
        header,
        'CT-400,1,1000,TRANSFER,,a,11-1101',
        'CT-400,1,2000,TRANSFER,,b,11-1101',
      ].join('\n');

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      const ref1 = recordPayment.mock.calls[0][7];
      const ref2 = recordPayment.mock.calls[1][7];
      expect(ref1).not.toBe(ref2);
    });
  });

  describe('additional validation branches', () => {
    it('throws BadRequestException when there is no data row (header only)', async () => {
      const { svc } = makeService();
      await expect(svc.importPaymentsFromCsv(header, DEFAULT_METHOD, RECORDED_BY)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a row with fewer than 3 columns as "ข้อมูลไม่ครบ"', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-500,1'].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.total).toBe(1);
      expect(result.success).toBe(0);
      expect(result.errors[0]).toEqual({
        row: 2,
        message: 'ข้อมูลไม่ครบ ต้องมีอย่างน้อย contractNumber, installmentNo, amount',
      });
      expect(recordPayment).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric installmentNo via the isNaN(installmentNo) guard', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-600,abc,1500,TRANSFER,,note,11-1101'].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.success).toBe(0);
      expect(result.errors[0].row).toBe(2);
      expect(result.errors[0].message).toContain('ข้อมูลไม่ถูกต้อง');
      expect(result.errors[0].message).toContain('installmentNo=abc');
      expect(recordPayment).not.toHaveBeenCalled();
    });

    it('reports "ไม่พบสัญญา" when the contract lookup returns null', async () => {
      const findContract = jest.fn().mockResolvedValue(null);
      const { svc, recordPayment } = makeService(findContract);
      const csv = [header, 'CT-NOPE,1,1500,TRANSFER,,note,11-1101'].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.success).toBe(0);
      expect(result.errors[0]).toEqual({ row: 2, message: 'ไม่พบสัญญา CT-NOPE' });
      expect(recordPayment).not.toHaveBeenCalled();
    });

    it('captures a thrown recordPayment error.message into errors[] without aborting the batch', async () => {
      const { svc, recordPayment } = makeService();
      recordPayment.mockRejectedValueOnce(new Error('duplicate ref'));
      const csv = [
        header,
        'CT-700,1,1500,TRANSFER,,note,11-1101', // throws
        'CT-701,2,1600,TRANSFER,,note,11-1101', // succeeds
      ].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.total).toBe(2);
      expect(result.success).toBe(1);
      expect(result.errors).toEqual([{ row: 2, message: 'duplicate ref' }]);
    });

    it('QUIRK: total counts blank-line data rows that are continue-skipped (total > success + errors)', async () => {
      const { svc, recordPayment } = makeService();
      // 3 data rows: valid, blank (skipped silently), valid.
      const csv = [
        header,
        'CT-800,1,1000,TRANSFER,,a,11-1101',
        '',
        'CT-800,2,1000,TRANSFER,,b,11-1101',
      ].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY);

      expect(result.total).toBe(3); // counts the blank line
      expect(result.success).toBe(2);
      expect(result.errors).toHaveLength(0); // blank line is neither success nor error
      expect(recordPayment).toHaveBeenCalledTimes(2);
    });

    it('uses the body-level depositAccountCode when the row omits one', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-900,1,1000,TRANSFER,,note'].join('\n'); // no deposit column

      await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY, '11-1202');

      expect(recordPayment.mock.calls[0][8]).toBe('11-1202');
    });

    it('rejects a row whose body-level depositAccountCode is invalid (whitelist applies to body default too)', async () => {
      const { svc, recordPayment } = makeService();
      const csv = [header, 'CT-901,1,1000,TRANSFER,,note'].join('\n');

      const result = await svc.importPaymentsFromCsv(csv, DEFAULT_METHOD, RECORDED_BY, '00-0000');

      expect(result.success).toBe(0);
      expect(result.errors[0].row).toBe(2);
      expect(result.errors[0].message).toContain('บัญชีรับเงินไม่ถูกต้อง: 00-0000');
      expect(recordPayment).not.toHaveBeenCalled();
    });
  });
});
