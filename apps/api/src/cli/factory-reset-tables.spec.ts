import { KEEP_TABLES, WIPE_TABLES } from './factory-reset-tables';

describe('factory-reset table lists — recurring bills (รีวิว I3)', () => {
  it('recurring_bill_occurrences is wiped (it references expense_documents + todos, both wiped) and not kept', () => {
    expect(WIPE_TABLES.has('recurring_bill_occurrences')).toBe(true);
    expect(KEEP_TABLES.has('recurring_bill_occurrences')).toBe(false);
  });
});
