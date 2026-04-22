export type SavingPlanStatus = 'ACTIVE' | 'COMPLETED' | 'APPLIED' | 'CANCELLED';

export interface SavingPlanPayment {
  id: string;
  amount: number;
  paidAt: string;
  paymentMethod: string;
}

export interface SavingPlan {
  id: string;
  planNumber: string;
  targetAmount: number;
  monthlyAmount: number;
  durationMonths: number;
  totalSaved: number;
  status: SavingPlanStatus;
  startedAt: string;
  nextPaymentDueAt: string | null;
  completedAt: string | null;
  targetProductModel: string | null;
  payments: SavingPlanPayment[];
}
