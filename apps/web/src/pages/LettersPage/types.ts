export type { LetterStatus, LetterType, LetterRow } from '@/pages/CollectionsPage/types/letter';

import type { LetterStatus, LetterType } from '@/pages/CollectionsPage/types/letter';
import type { LetterRow } from '@/pages/CollectionsPage/types/letter';

export interface LettersListResponse {
  data: LetterRow[];
  total: number;
  page: number;
  limit: number;
}

export interface LettersListFilters {
  status?: LetterStatus;
  letterType?: LetterType;
  branchId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}
