export type ApplicationStatus =
  | 'SUBMITTED'
  | 'SCHEDULED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'CONTRACT_SIGNED'
  | 'REJECTED'
  | 'NO_SHOW'
  | 'EXPIRED'
  | 'CANCELLED';

export interface Application {
  id: string;
  applicationNumber: string;
  status: ApplicationStatus;
  fullName: string;
  phone: string;
  proposedDownPayment: number;
  proposedTotalMonths: number;
  proposedMonthlyPayment: number;
  scheduledAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  product: { id: string; name: string; gallery: string[] };
}
