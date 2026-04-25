import type { QueueFilterState } from '../hooks/useQueueFilter';

export interface SystemPreset {
  key: string;
  name: string;
  filter: QueueFilterState;
}

/**
 * Hardcoded system-wide filter presets shown above user-saved presets in the
 * dropdown. These cover the four most common collector views:
 *  - urgent-today: own tickets in the early-overdue (1–7 day) bucket
 *  - overdue-60-plus: deeper-overdue triage (61+ days)
 *  - legal-pipeline: contracts in LEGAL status — handed to legal team
 *  - untouched-7-days: contracts not contacted in over a week
 */
export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    key: 'urgent-today',
    name: 'ด่วนวันนี้',
    filter: { assigned: 'self', overdueBuckets: ['1-7'] },
  },
  {
    key: 'overdue-60-plus',
    name: 'เลยกำหนด 60+',
    filter: { overdueBuckets: ['61-90', '90+'] },
  },
  {
    key: 'legal-pipeline',
    name: 'LEGAL pipeline',
    filter: { contractStatuses: ['LEGAL'] },
  },
  {
    key: 'untouched-7-days',
    name: 'ยังไม่แตะ 7 วัน',
    filter: { lastContacted: 'over_7_days' },
  },
];
