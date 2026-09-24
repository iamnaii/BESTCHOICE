import { describe, it, expect } from 'vitest';
import {
  FINANCE_DOC_SLOTS,
  FINANCE_SLOT_LABELS,
  FINANCE_SLOT_ORDER,
  FINANCE_REQUIRED_SLOTS,
  FINANCE_PRIMARY_SLOTS,
} from './finance-doc-slots';

describe('finance doc slots', () => {
  it('has exactly 13 slots', () => {
    expect(FINANCE_DOC_SLOTS).toHaveLength(13);
  });

  it('gives every slot a non-empty Thai label', () => {
    for (const slot of FINANCE_DOC_SLOTS) {
      expect(FINANCE_SLOT_LABELS[slot]).toBeTruthy();
      expect(FINANCE_SLOT_LABELS[slot].trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps required as a subset of primary, and primary a subset of all slots', () => {
    for (const slot of FINANCE_REQUIRED_SLOTS) {
      expect(FINANCE_PRIMARY_SLOTS).toContain(slot);
    }
    for (const slot of FINANCE_PRIMARY_SLOTS) {
      expect(FINANCE_DOC_SLOTS).toContain(slot);
    }
  });

  it('keeps FINANCE_SLOT_ORDER identical to the FINANCE_DOC_SLOTS tuple order', () => {
    expect(FINANCE_SLOT_ORDER).toEqual([...FINANCE_DOC_SLOTS]);
  });
});
