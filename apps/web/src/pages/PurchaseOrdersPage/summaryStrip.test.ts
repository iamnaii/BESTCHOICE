import { describe, it, expect } from 'vitest';
import { SUMMARY_CARDS, TONE_STYLES, type PurchasingSummary } from './summaryStrip';

describe('SUMMARY_CARDS', () => {
  it('defines exactly the 7 B0 summary keys, in order, with no duplicates', () => {
    const keys = SUMMARY_CARDS.map((c) => c.key);
    expect(keys).toEqual([
      'pendingApproval',
      'toOrder',
      'incoming',
      'overdue',
      'receiving',
      'waitingQc',
      'unpaid',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every key of the PurchasingSummary type (compile-time + runtime parity)', () => {
    const sample: PurchasingSummary = {
      pendingApproval: 1, toOrder: 2, incoming: 3, overdue: 4, receiving: 5, waitingQc: 6, unpaid: 7,
    };
    for (const card of SUMMARY_CARDS) {
      expect(typeof sample[card.key]).toBe('number');
    }
  });

  it('every card has a Thai label and a defined lucide icon', () => {
    for (const card of SUMMARY_CARDS) {
      expect(card.label.length).toBeGreaterThan(0);
      // lucide icons are forwardRef components → function (object in some builds)
      expect(['function', 'object']).toContain(typeof card.icon);
    }
  });

  it('overdue card routes to list+overdueOnly; toOrder→APPROVED; incoming→ORDERED; receiving→PARTIALLY_RECEIVED; pendingApproval→DRAFT', () => {
    const byKey = Object.fromEntries(SUMMARY_CARDS.map((c) => [c.key, c.action]));
    expect(byKey.overdue).toEqual({ tab: 'list', status: 'ORDERED', overdueOnly: true });
    expect(byKey.toOrder).toEqual({ tab: 'list', status: 'APPROVED', overdueOnly: false });
    expect(byKey.incoming).toEqual({ tab: 'list', status: 'ORDERED', overdueOnly: false });
    expect(byKey.receiving).toEqual({ tab: 'list', status: 'PARTIALLY_RECEIVED', overdueOnly: false });
    expect(byKey.pendingApproval).toEqual({ tab: 'list', status: 'DRAFT', overdueOnly: false });
  });

  it('unpaid card routes to the payable tab; waitingQc opens the qc panel', () => {
    const byKey = Object.fromEntries(SUMMARY_CARDS.map((c) => [c.key, c.action]));
    expect(byKey.unpaid).toEqual({ tab: 'payable' });
    expect(byKey.waitingQc).toEqual({ panel: 'qc' });
  });

  it('TONE_STYLES uses only design-token classes (no hardcoded gray/hex/white)', () => {
    const blob = JSON.stringify(TONE_STYLES);
    expect(blob).not.toMatch(/#[0-9a-fA-F]{3,6}/); // no hex
    expect(blob).not.toMatch(/\bbg-white\b/);
    expect(blob).not.toMatch(/-gray-/);
    // every tone present
    expect(Object.keys(TONE_STYLES).sort()).toEqual(
      ['destructive', 'info', 'primary', 'success', 'warning'].sort(),
    );
  });
});
