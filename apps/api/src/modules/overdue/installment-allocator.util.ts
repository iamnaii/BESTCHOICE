import { Decimal } from '@prisma/client/runtime/library';

export interface InstallmentSlice {
  id: string;
  dueDate: Date;
  remainingAmount: Decimal;
}

/**
 * FIFO greedy: fill oldest installment first until accumulated remaining
 * amount >= target. Returns ordered installment IDs covered (partial coverage
 * of last one is included — UI surfaces the partial).
 */
export function allocateFifo(installments: InstallmentSlice[], target: Decimal): string[] {
  const sorted = [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const result: string[] = [];
  let acc = new Decimal(0);
  for (const i of sorted) {
    if (acc.gte(target)) break;
    result.push(i.id);
    acc = acc.add(i.remainingAmount);
  }
  return result;
}
