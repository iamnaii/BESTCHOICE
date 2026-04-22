import type { PreCheckResponse } from '@/lib/api/customer-precheck';

export type IntakeStep = 'quick' | 'precheck' | 'full' | 'done';

export interface QuickIntakeForm {
  nationalId: string;
  phone: string;
  firstName: string;
  lastName: string;
  prefix?: string;
  bankName?: string;
  statementFiles: File[];
}

export interface FullIntakeForm {
  // Identity (pre-filled from quick)
  prefix?: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  nationalId: string;
  birthDate?: string;
  // Contact
  phone: string;
  phoneSecondary?: string;
  email?: string;
  lineId?: string;
  facebookLink?: string;
  facebookName?: string;
  // Address (structured, serialized to JSON on save)
  addressIdCard?: string;
  addressCurrent?: string;
  addressCurrentType?: string; // OWN | RELATIVE | RENT
  googleMapLink?: string;
  addressWork?: string;
  // Work
  occupation?: string;
  salary?: string;
  workplace?: string;
  // References (4 people)
  references: {
    prefix?: string;
    firstName: string;
    lastName: string;
    phone: string;
    relationship: string;
  }[];
}

export interface WizardState {
  step: IntakeStep;
  quickForm: QuickIntakeForm;
  preCheckResult: PreCheckResponse | null;
  fullForm: FullIntakeForm | null;
}
