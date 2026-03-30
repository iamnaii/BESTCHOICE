import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private auditService: AuditService,
  ) {}

  /** Enforce branch-level access: SALES/BRANCH_MANAGER can only operate on their own branch */
  async validateBranchAccess(
    contractId: string,
    user: { role: string; branchId: string | null },
  ) {
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') return;

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { branchId: true },
    });
    if (contract && user.branchId && contract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
    }
  }

  // ─── Record a single payment (บังคับ upload หลักฐาน) ──
  async recordPayment(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    evidenceUrl?: string,
    notes?: string,
    transactionRef?: string,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    }

    // บังคับ upload หลักฐานการชำระเงิน (สลิป/เลขอ้างอิง)
    if (!evidenceUrl && !transactionRef) {
      throw new BadRequestException('ต้อง upload หลักฐานการชำระเงิน (สลิปโอนเงิน) หรือระบุเลขอ้างอิงธุรกรรม');
    }

    // Idempotency: reject duplicate transactionRef for the same contract
    // Check all payment statuses (not just PAID) to prevent concurrent duplicates
    if (transactionRef) {
      const existing = await this.prisma.payment.findFirst({
        where: {
          contractId,
          notes: { contains: `ref:${transactionRef}` },
          status: { in: ['PAID', 'PARTIALLY_PAID'] },
        },
      });
      if (existing) {
        throw new BadRequestException(`ธุรกรรมนี้ถูกบันทึกแล้ว (อ้างอิง: ${transactionRef})`);
      }
    }

    // Use serializable transaction to prevent concurrent duplicate payments
    const updated = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }

      const payment = await tx.payment.findFirst({
        where: { contractId, installmentNo },
      });
      if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
      if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');

      const decAmountDue = new Prisma.Decimal(payment.amountDue).add(new Prisma.Decimal(payment.lateFee));
      const decPrevPaid = new Prisma.Decimal(payment.amountPaid);
      const decRemaining = decAmountDue.sub(decPrevPaid);
      const decAmount = new Prisma.Decimal(amount);

      // Prevent overpayment: cap amount at what is owed for this installment
      if (decAmount.greaterThan(decRemaining)) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${decRemaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) กรุณาใช้ระบบจัดสรรอัตโนมัติสำหรับการชำระหลายงวด`,
        );
      }
      const decTotalPaid = decPrevPaid.add(decAmount);

      const isPaidInFull = decTotalPaid.greaterThanOrEqualTo(decAmountDue);

      // Append transactionRef to notes for idempotency tracking
      const updatedNotes = transactionRef
        ? [notes, `ref:${transactionRef}`].filter(Boolean).join(' | ')
        : (notes || payment.notes);

      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: decTotalPaid,
          paidDate: isPaidInFull ? new Date() : null,
          paymentMethod: paymentMethod as PaymentMethod,
          status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
          recordedById,
          evidenceUrl: evidenceUrl || payment.evidenceUrl,
          notes: updatedNotes,
        },
      });

      // Check if all payments are completed → update contract status
      if (isPaidInFull) {
        await this.checkContractCompletion(contractId, tx);
      }

      return result;
    });

    // Financial audit trail
    await this.auditService.logPaymentEvent({
      userId: recordedById,
      contractId,
      paymentId: updated.id,
      action: updated.status === 'PAID' ? 'PAYMENT_RECORDED' : 'PAYMENT_PARTIAL',
      amount,
      installmentNo,
      details: { paymentMethod, transactionRef, totalPaid: new Prisma.Decimal(updated.amountPaid).toNumber() },
    });

    // Auto-generate e-Receipt after successful payment
    if (updated.status === 'PAID') {
      try {
        await this.receiptsService.generateReceipt(
          contractId,
          updated.id,
          'INSTALLMENT',
          amount,
          installmentNo,
          paymentMethod,
          transactionRef || null,
          recordedById,
        );
      } catch (error) {
        // Receipt generation failure should not block payment, but must be logged
        this.logger.error(
          `Failed to generate receipt for payment ${updated.id} (contract: ${contractId}, installment: ${installmentNo})`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return updated;
  }

  // ─── Auto-allocate payment to next pending installment ─
  async autoAllocatePayment(
    contractId: string,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    notes?: string,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    }

    // Wrap entire allocation in a serializable transaction to prevent double-payment
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { payments: { orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }

      let decRemaining = new Prisma.Decimal(amount);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];

      // Get unpaid payments in order
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) throw new BadRequestException('ไม่มีงวดค้างชำระ');

      for (const payment of unpaid) {
        if (decRemaining.lessThanOrEqualTo(0)) break;

        const decOwed = new Prisma.Decimal(payment.amountDue)
          .add(new Prisma.Decimal(payment.lateFee))
          .sub(new Prisma.Decimal(payment.amountPaid));
        const decPayAmount = Prisma.Decimal.min(decRemaining, decOwed);
        const decTotalPaid = new Prisma.Decimal(payment.amountPaid).add(decPayAmount);
        const decFullAmount = new Prisma.Decimal(payment.amountDue).add(new Prisma.Decimal(payment.lateFee));
        const isPaidInFull = decTotalPaid.greaterThanOrEqualTo(decFullAmount);

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: decTotalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: paymentMethod as PaymentMethod,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: notes || payment.notes,
          },
        });

        results.push(updated);
        decRemaining = decRemaining.sub(decPayAmount);

        // Check contract completion after each full payment
        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);
        }
      }

      // Auto-generate e-Receipts for fully paid installments
      for (const paid of results.filter(r => r.status === 'PAID')) {
        try {
          await this.receiptsService.generateReceipt(
            contractId,
            paid.id,
            'INSTALLMENT',
            new Prisma.Decimal(paid.amountPaid).toNumber(),
            paid.installmentNo,
            paymentMethod,
            null,
            recordedById,
          );
        } catch (error) {
          this.logger.error(
            `Failed to generate receipt for payment ${paid.id} (contract: ${contractId}, installment: ${paid.installmentNo})`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      const decOverpayment = decRemaining.greaterThan(0) ? decRemaining : new Prisma.Decimal(0);
      if (decOverpayment.greaterThan(0)) {
        // Store overpayment as credit balance on the contract
        await tx.contract.update({
          where: { id: contractId },
          data: {
            creditBalance: { increment: decOverpayment },
          },
        });

        const allocated = new Prisma.Decimal(amount).sub(decRemaining);
        this.logger.warn(
          `Overpayment of ${decOverpayment} THB credited to contract ${contractId}. ` +
          `Customer paid ${amount} THB, ${allocated} THB allocated, ${decOverpayment} THB stored as credit.`,
        );
      }

      const totalAllocated = new Prisma.Decimal(amount).sub(decRemaining).toNumber();
      const overpayment = decOverpayment.toNumber();
      return {
        allocatedPayments: results,
        totalAllocated,
        overpayment,
        overpaymentMessage: overpayment > 0
          ? `มีเงินเกินจำนวน ${overpayment.toLocaleString()} บาท บันทึกเป็นยอดเครดิตในสัญญา`
          : null,
      };
    });
  }

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string, page = 1, limit = 50) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const where = { contractId };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { installmentNo: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: {
    branchId?: string;
    date?: string;
    status?: string;
    search?: string;
    dunningStage?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] };
    }

    // Build contract filter object to combine multiple conditions
    const contractWhere: Record<string, unknown> = {};

    if (filters.branchId) {
      contractWhere.branchId = filters.branchId;
    }

    if (filters.dunningStage) {
      contractWhere.dunningStage = filters.dunningStage;
    }

    if (filters.search) {
      const search = filters.search.trim();
      contractWhere.OR = [
        { contractNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search } } },
      ];
    }

    if (Object.keys(contractWhere).length > 0) {
      where.contract = contractWhere;
    }

    if (filters.date) {
      const d = new Date(filters.date);
      where.dueDate = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    }

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string, page = 1, limit = 50) {
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const where: Record<string, unknown> = {
      paidDate: { gte: startOfDay, lt: endOfDay },
      status: 'PAID',
    };

    if (branchId) {
      where.contract = { branchId };
    }

    const [payments, total, aggregation] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paidDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amountPaid: true, lateFee: true },
      }),
    ]);

    // Compute byMethod from the current page (for display) — summary totals use aggregate
    const byMethodDec: Record<string, Prisma.Decimal> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethodDec[method] = (byMethodDec[method] || new Prisma.Decimal(0)).add(new Prisma.Decimal(p.amountPaid));
    });
    const byMethod: Record<string, number> = {};
    for (const [k, v] of Object.entries(byMethodDec)) {
      byMethod[k] = v.toNumber();
    }

    return {
      date,
      totalPayments: total,
      totalAmount: new Prisma.Decimal(aggregation._sum.amountPaid || 0).round().toNumber(),
      totalLateFees: new Prisma.Decimal(aggregation._sum.lateFee || 0).round().toNumber(),
      byMethod,
      data: payments,
      total,
      page,
      limit,
    };
  }

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

  // ─── Check if contract is fully paid ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async checkContractCompletion(contractId: string, tx?: { payment: { count: (...args: any[]) => Promise<number> }; contract: { update: (...args: any[]) => Promise<any> } }) {
    const db = tx || this.prisma;
    const unpaid = await db.payment.count({
      where: { contractId, status: { not: 'PAID' } },
    });

    if (unpaid === 0) {
      // All installments paid → mark contract as COMPLETED
      await db.contract.update({
        where: { id: contractId },
        data: { status: 'COMPLETED' },
      });
    }
  }

  // ─── Apply credit balance to next pending installment ─
  async applyCreditBalance(contractId: string, recordedById: string) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { payments: { orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract) throw new NotFoundException('ไม่พบสัญญา');

      const decCredit = new Prisma.Decimal(contract.creditBalance);
      if (decCredit.lessThanOrEqualTo(0)) {
        throw new BadRequestException('ไม่มียอดเครดิตในสัญญานี้');
      }

      // Find next unpaid installment
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) {
        throw new BadRequestException('ไม่มีงวดค้างชำระ');
      }

      let decRemaining = decCredit;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];

      for (const payment of unpaid) {
        if (decRemaining.lessThanOrEqualTo(0)) break;

        const decOwed = new Prisma.Decimal(payment.amountDue)
          .add(new Prisma.Decimal(payment.lateFee))
          .sub(new Prisma.Decimal(payment.amountPaid));
        const decPayAmount = Prisma.Decimal.min(decRemaining, decOwed);
        const decTotalPaid = new Prisma.Decimal(payment.amountPaid).add(decPayAmount);
        const decFullAmount = new Prisma.Decimal(payment.amountDue).add(new Prisma.Decimal(payment.lateFee));
        const isPaidInFull = decTotalPaid.greaterThanOrEqualTo(decFullAmount);

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: decTotalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: 'CREDIT_BALANCE',
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: [payment.notes, `ใช้เครดิต ${decPayAmount.toNumber().toLocaleString()} บาท`].filter(Boolean).join(' | '),
          },
        });

        results.push(updated);
        decRemaining = decRemaining.sub(decPayAmount);

        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);
        }
      }

      // Update credit balance
      const decUsedCredit = decCredit.sub(decRemaining);
      await tx.contract.update({
        where: { id: contractId },
        data: { creditBalance: decRemaining },
      });

      return {
        allocatedPayments: results,
        creditUsed: decUsedCredit.toNumber(),
        creditRemaining: decRemaining.toNumber(),
      };
    });
  }

  // ─── Get credit balance for a contract ─────────────
  async getCreditBalance(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, creditBalance: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    return { creditBalance: new Prisma.Decimal(contract.creditBalance).toNumber() };
  }

  // ─── Batch CSV Payment Import ────────────────────────
  /**
   * Parse CSV and record payments in batch.
   * Expected CSV format: contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes
   * First row is header (skipped).
   */
  async importPaymentsFromCsv(
    csvText: string,
    defaultPaymentMethod: string,
    recordedById: string,
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

      const [contractNumber, installmentNoStr, amountStr, paymentMethod, transactionRef, notes] = cols;
      const installmentNo = parseInt(installmentNoStr, 10);
      const amount = parseFloat(amountStr);

      if (!contractNumber || isNaN(installmentNo) || isNaN(amount) || amount <= 0) {
        errors.push({ row, message: `ข้อมูลไม่ถูกต้อง: contractNumber=${contractNumber}, installmentNo=${installmentNoStr}, amount=${amountStr}` });
        continue;
      }

      try {
        // Lookup contract by number
        const contract = await this.prisma.contract.findUnique({
          where: { contractNumber },
          select: { id: true },
        });
        if (!contract) {
          errors.push({ row, message: `ไม่พบสัญญา ${contractNumber}` });
          continue;
        }

        await this.recordPayment(
          contract.id,
          installmentNo,
          amount,
          paymentMethod || defaultPaymentMethod,
          recordedById,
          undefined, // evidenceUrl
          notes || `CSV import row ${row}`,
          transactionRef || `CSV-${Date.now()}-${row}-${Math.random().toString(36).slice(2, 8)}`,
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

  // ─── Waive late fee (wrapped in transaction to prevent race condition) ─
  async waiveLateFee(paymentId: string, reason: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('ไม่พบรายการชำระ');
      if (payment.lateFeeWaived) throw new BadRequestException('รายการนี้ยกเว้นค่าปรับแล้ว');
      const decLateFee = new Prisma.Decimal(payment.lateFee);
      if (decLateFee.lessThanOrEqualTo(0)) throw new BadRequestException('รายการนี้ไม่มีค่าปรับ');

      const originalLateFee = decLateFee.toNumber();
      const notes = [payment.notes, `ยกเว้นค่าปรับ ${originalLateFee.toLocaleString()} บาท — ${reason}`].filter(Boolean).join(' | ');

      // Check if payment becomes fully paid after waiving late fee
      const decTotalOwed = new Prisma.Decimal(payment.amountDue); // without late fee
      const decAmountPaid = new Prisma.Decimal(payment.amountPaid);
      const isNowFullyPaid = decAmountPaid.greaterThanOrEqualTo(decTotalOwed);

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          lateFee: 0,
          lateFeeWaived: true,
          notes,
          ...(isNowFullyPaid && payment.status !== 'PAID' ? { status: 'PAID', paidDate: new Date() } : {}),
        },
      });

      // Check contract completion inside transaction
      if (isNowFullyPaid && payment.status !== 'PAID') {
        await this.checkContractCompletion(payment.contractId, tx);
      }

      return { updated, originalLateFee, isNowFullyPaid, contractId: payment.contractId, installmentNo: payment.installmentNo };
    });

    // Financial audit trail (outside transaction — audit failure shouldn't roll back waiver)
    await this.auditService.logPaymentEvent({
      userId,
      contractId: result.contractId,
      paymentId,
      action: 'LATE_FEE_WAIVED',
      amount: result.originalLateFee,
      installmentNo: result.installmentNo,
      details: { reason, wasFeeAmount: result.originalLateFee, becameFullyPaid: result.isNowFullyPaid },
    });

    return { ...result.updated, originalLateFee: result.originalLateFee };
  }
}
