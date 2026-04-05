import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma, PaymentMethod } from '@prisma/client';
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
      select: { branchId: true, deletedAt: true },
    });
    if (contract && !contract.deletedAt && user.branchId && contract.branchId !== user.branchId) {
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

    // Capture dueDate for loyalty points check (on-time = paidDate <= dueDate)
    let capturedDueDate: Date | null = null;
    let capturedCustomerId: string | null = null;

    // Use serializable transaction to prevent concurrent duplicate payments
    const updated = await this.prisma.$transaction(async (tx) => {
      // Idempotency: reject duplicate transactionRef INSIDE transaction
      // to prevent race condition where two concurrent requests both pass the check
      if (transactionRef) {
        const existing = await tx.payment.findFirst({
          where: {
            contractId,
            deletedAt: null,
            notes: { contains: `ref:${transactionRef}` },
            status: { in: ['PAID', 'PARTIALLY_PAID'] },
          },
        });
        if (existing) {
          throw new BadRequestException(`ธุรกรรมนี้ถูกบันทึกแล้ว (อ้างอิง: ${transactionRef})`);
        }
      }

      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }
      capturedCustomerId = contract.customerId;

      const payment = await tx.payment.findFirst({
        where: { contractId, installmentNo, deletedAt: null },
      });
      if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
      if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');
      capturedDueDate = payment.dueDate;

      // Real-time late fee: recalculate at payment time (cron may not have run yet)
      let lateFee = Number(payment.lateFee);
      if (!payment.lateFeeWaived && payment.dueDate < new Date()) {
        const daysOverdue = Math.floor((Date.now() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue > 0) {
          const config = await tx.systemConfig.findUnique({ where: { key: 'late_fee_per_day' } });
          const capConfig = await tx.systemConfig.findUnique({ where: { key: 'late_fee_cap' } });
          const feePerDay = config ? Number(config.value) : 50;
          const cap = capConfig ? Number(capConfig.value) : 1500;
          const calculatedFee = Math.min(daysOverdue * feePerDay, cap);
          if (calculatedFee > lateFee) {
            lateFee = calculatedFee;
            await tx.payment.update({ where: { id: payment.id }, data: { lateFee } });
          }
        }
      }

      const amountDue = Number(payment.amountDue) + lateFee;
      const prevPaid = Number(payment.amountPaid);
      const remaining = amountDue - prevPaid;

      // Prevent overpayment: cap amount at what is owed for this installment
      if (amount > remaining) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) กรุณาใช้ระบบจัดสรรอัตโนมัติสำหรับการชำระหลายงวด`,
        );
      }
      const totalPaid = prevPaid + amount;

      const isPaidInFull = totalPaid >= amountDue;

      // Append transactionRef to notes for idempotency tracking
      const updatedNotes = transactionRef
        ? [notes, `ref:${transactionRef}`].filter(Boolean).join(' | ')
        : (notes || payment.notes);

      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: totalPaid,
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
      details: { paymentMethod, transactionRef, totalPaid: Number(updated.amountPaid) },
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

      // Award loyalty points for on-time payment (non-blocking)
      if (capturedCustomerId && capturedDueDate) {
        await this.awardLoyaltyPoints(
          capturedCustomerId,
          contractId,
          updated.id,
          amount,
          updated.paidDate,
          capturedDueDate,
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
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }

      let remaining = amount;
      const results: Awaited<ReturnType<typeof tx.payment.update>>[] = [];

      // Get unpaid payments in order
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) throw new BadRequestException('ไม่มีงวดค้างชำระ');

      for (const payment of unpaid) {
        if (remaining <= 0) break;

        const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
        const payAmount = Math.min(remaining, amountDue);
        const totalPaid = Number(payment.amountPaid) + payAmount;
        const isPaidInFull = totalPaid >= (Number(payment.amountDue) + Number(payment.lateFee));

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: totalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: paymentMethod as PaymentMethod,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: notes || payment.notes,
          },
        });

        results.push(updated);
        remaining -= payAmount;

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
            Number(paid.amountPaid),
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

      const overpayment = remaining > 0 ? remaining : 0;
      if (overpayment > 0) {
        // Store overpayment as credit balance on the contract
        await tx.contract.update({
          where: { id: contractId },
          data: {
            creditBalance: { increment: overpayment },
          },
        });

        this.logger.warn(
          `Overpayment of ${overpayment} THB credited to contract ${contractId}. ` +
          `Customer paid ${amount} THB, ${amount - remaining} THB allocated, ${overpayment} THB stored as credit.`,
        );
      }

      return {
        allocatedPayments: results,
        totalAllocated: amount - remaining,
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

    const where = { contractId, deletedAt: null };
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
    const where: Record<string, unknown> = { deletedAt: null };

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
      deletedAt: null,
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
    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethod[method] = (byMethod[method] || 0) + Number(p.amountPaid);
    });

    return {
      date,
      totalPayments: total,
      totalAmount: Math.round(Number(aggregation._sum.amountPaid || 0)),
      totalLateFees: Math.round(Number(aggregation._sum.lateFee || 0)),
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
  private async checkContractCompletion(contractId: string, tx?: { payment: { count: (...args: unknown[]) => Promise<number> }; contract: { update: (...args: unknown[]) => Promise<unknown> } }) {
    const db = tx || this.prisma;
    const unpaid = await db.payment.count({
      where: { contractId, status: { not: 'PAID' }, deletedAt: null },
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
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

      const credit = Number(contract.creditBalance);
      if (credit <= 0) {
        throw new BadRequestException('ไม่มียอดเครดิตในสัญญานี้');
      }

      // Find next unpaid installment
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) {
        throw new BadRequestException('ไม่มีงวดค้างชำระ');
      }

      let remaining = credit;
      const results: Awaited<ReturnType<typeof tx.payment.update>>[] = [];

      for (const payment of unpaid) {
        if (remaining <= 0) break;

        const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
        const payAmount = Math.min(remaining, amountDue);
        const totalPaid = Number(payment.amountPaid) + payAmount;
        const isPaidInFull = totalPaid >= (Number(payment.amountDue) + Number(payment.lateFee));

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: totalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: 'CREDIT_BALANCE',
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: [payment.notes, `ใช้เครดิต ${payAmount.toLocaleString()} บาท`].filter(Boolean).join(' | '),
          },
        });

        results.push(updated);
        remaining -= payAmount;

        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);
        }
      }

      // Update credit balance
      const usedCredit = credit - remaining;
      await tx.contract.update({
        where: { id: contractId },
        data: { creditBalance: remaining },
      });

      return {
        allocatedPayments: results,
        creditUsed: usedCredit,
        creditRemaining: remaining,
      };
    });
  }

  // ─── Get credit balance for a contract ─────────────
  async getCreditBalance(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, creditBalance: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return { creditBalance: Number(contract.creditBalance) };
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
        const contract = await this.prisma.contract.findFirst({
          where: { contractNumber, deletedAt: null },
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
      if (!payment || payment.deletedAt) throw new NotFoundException('ไม่พบรายการชำระ');
      if (payment.lateFeeWaived) throw new BadRequestException('รายการนี้ยกเว้นค่าปรับแล้ว');
      if (Number(payment.lateFee) <= 0) throw new BadRequestException('รายการนี้ไม่มีค่าปรับ');

      const originalLateFee = Number(payment.lateFee);
      const notes = [payment.notes, `ยกเว้นค่าปรับ ${originalLateFee.toLocaleString()} บาท — ${reason}`].filter(Boolean).join(' | ');

      // Check if payment becomes fully paid after waiving late fee
      const totalOwed = Number(payment.amountDue); // without late fee
      const amountPaid = Number(payment.amountPaid);
      const isNowFullyPaid = amountPaid >= totalOwed;

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

  // ─── Award loyalty points for on-time payment ──────────
  private async awardLoyaltyPoints(
    customerId: string,
    contractId: string,
    paymentId: string,
    amount: number,
    paidDate: Date | null,
    dueDate: Date,
  ) {
    // Only award for on-time payments (ชำระตรงเวลาหรือก่อนกำหนด)
    if (!paidDate || paidDate > dueDate) return;

    const points = Math.floor(amount / 100); // 1 point per 100 baht
    if (points <= 0) return;

    try {
      // Idempotent upsert: paymentId is unique — safe to call multiple times
      await this.prisma.loyaltyPoint.upsert({
        where: { paymentId },
        create: { customerId, paymentId, contractId, points, reason: 'ON_TIME_PAYMENT' },
        update: {}, // Already awarded — do nothing
      });
    } catch (error) {
      this.logger.error(
        `Failed to award loyalty points for payment ${paymentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
