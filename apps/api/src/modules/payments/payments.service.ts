import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
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

      const amountDue = Number(payment.amountDue) + Number(payment.lateFee);
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

      let remaining = amount;
      const results: any[] = [];

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
  async getContractPayments(contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.payment.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      include: {
        recordedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: { branchId?: string; date?: string; status?: string; search?: string }) {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] };
    }

    if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }

    if (filters.search) {
      const search = filters.search.trim();
      where.contract = {
        ...(where.contract as Record<string, unknown> || {}),
        OR: [
          { contractNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search } } },
        ],
      };
    }

    if (filters.date) {
      const d = new Date(filters.date);
      where.dueDate = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    }

    return this.prisma.payment.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
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
    });
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string) {
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

    const payments = await this.prisma.payment.findMany({
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
    });

    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
    const totalLateFees = payments.reduce((sum, p) => sum + Number(p.lateFee), 0);

    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethod[method] = (byMethod[method] || 0) + Number(p.amountPaid);
    });

    return {
      date,
      totalPayments: payments.length,
      totalAmount: Math.round(totalAmount),
      totalLateFees: Math.round(totalLateFees),
      byMethod,
      payments,
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
      const results: any[] = [];

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
            paymentMethod: 'CREDIT_BALANCE' as any,
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
      select: { id: true, contractNumber: true, creditBalance: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
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
}
