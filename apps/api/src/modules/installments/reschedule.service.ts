import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RescheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    contractId: string;
    fromInstallmentNo: number;
    daysToShift: number;
  }): Promise<{ rescheduleFee: Decimal }> {
    const installments = await this.prisma.installmentSchedule.findMany({
      where: {
        contractId: input.contractId,
        installmentNo: { gte: input.fromInstallmentNo },
        deletedAt: null,
      } as any,
      orderBy: { installmentNo: 'asc' },
    });
    if (!installments.length) throw new Error('No installments to reschedule');

    // Use contract.monthlyPayment as the installment total (includes commission + VAT).
    // installment.amountDue only carries principal+interest+vat and does not include commission,
    // so it would undercount the reschedule fee.
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: input.contractId },
      select: { monthlyPayment: true },
    });
    const firstInstTotal = new Decimal(contract.monthlyPayment.toString());

    const fee = firstInstTotal
      .div(30)
      .times(input.daysToShift)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);

    return this.prisma.$transaction(async (tx) => {
      for (const inst of installments) {
        const newDue = new Date(inst.dueDate);
        newDue.setDate(newDue.getDate() + input.daysToShift);
        await tx.installmentSchedule.update({
          where: { id: inst.id },
          data: {
            dueDate: newDue,
            rescheduledFromDate: inst.dueDate,
            rescheduleCount: { increment: 1 },
          } as any,
        });
      }

      // Reduce last installment amountDue by fee
      const last = installments[installments.length - 1];
      await tx.installmentSchedule.update({
        where: { id: last.id },
        data: { amountDue: firstInstTotal.minus(fee) } as any,
      });

      // Reset consecutiveMissed if field exists (safe to skip if not present)
      try {
        await (tx.contract as any).update({
          where: { id: input.contractId },
          data: { consecutiveMissed: 0 },
        });
      } catch {
        // field does not exist on schema — safe to skip
      }

      return { rescheduleFee: fee };
    });
  }
}
