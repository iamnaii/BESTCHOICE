import { describe, it, expect } from 'vitest';
import { isGfinPickable, gfinStep, slotCounts, needsAttention, pickableAttachedIds, SLOT_ORDER, REQUIRED_SLOTS } from './gfin';
// readSeen/markSeen เป็น wrapper ของ localStorage ที่ try/catch — ไม่ต้องเทสต์แยก

const app = (over: Partial<import('./gfin').FinanceApplication> = {}): import('./gfin').FinanceApplication => ({
  id: 'a1', number: 'BC-260924-001', status: 'DRAFT', roomId: 'r1', customerId: null, productId: null, customer: null, product: null,
  occupationOverride: null, messageOverride: null, messageText: null, sentAt: null, sentVia: null, resultSource: null,
  shareExpiresAt: null, shareRevokedAt: null, shareViewCount: 0, shareLastViewedAt: null, lastPartnerEventAt: null, closedAt: null,
  files: [], events: [], createdAt: '2026-09-24T12:00:00Z', ...over,
});
const preview = (over: Partial<import('./gfin').FinancePreview> = {}): import('./gfin').FinancePreview => ({
  text: '', values: {} as never, missingFields: [], missingRequiredSlots: [], warnings: [], canSend: true, ...over,
});

describe('isGfinPickable', () => {
  it('accepts IMAGE/FILE with a media url or a LINE message id, rejects text and legacy LINE media without id', () => {
    expect(isGfinPickable({ type: 'IMAGE', mediaUrl: 'https://x/a.jpg' })).toBe(true);
    expect(isGfinPickable({ type: 'FILE', mediaUrl: null, externalMessageId: '555' })).toBe(true);
    expect(isGfinPickable({ type: 'IMAGE', mediaUrl: null, externalMessageId: null })).toBe(false);
    expect(isGfinPickable({ type: 'TEXT', mediaUrl: 'https://x/a.jpg' })).toBe(false);
  });
});
describe('gfinStep', () => {
  it('1 until the customer fields are complete, 2 until a product is chosen, 3 until required slots exist, then 4', () => {
    expect(gfinStep(app(), preview({ missingFields: ['customerName'] }))).toBe(1);
    expect(gfinStep(app({ customerId: 'c1' }), preview({ missingFields: ['occupation'] }))).toBe(1);
    expect(gfinStep(app({ customerId: 'c1' }), preview())).toBe(2);
    expect(gfinStep(app({ customerId: 'c1', productId: 'p1' }), preview({ missingRequiredSlots: ['INCOME'] }))).toBe(3);
    expect(gfinStep(app({ customerId: 'c1', productId: 'p1' }), preview())).toBe(4);
  });
});
describe('slotCounts / needsAttention / constants', () => {
  it('counts files per slot with zeros for every slot', () => {
    const c = slotCounts([{ id: 'f', slot: 'ID_CARD', mimeType: 'image/jpeg', size: 1, originalName: null, source: 'CHAT_MESSAGE', sourceMessageId: 'm', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }]);
    expect(c.ID_CARD).toBe(1);
    expect(c.OTHER).toBe(0);
    expect(Object.keys(c)).toEqual(SLOT_ORDER);
  });
  it('flags a partner event newer than the last time the tab was opened; nothing for drafts or already-seen', () => {
    const t1 = '2026-09-24T12:14:00Z', t0 = '2026-09-24T12:00:00Z';
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }))).toBe(true);
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }), t0)).toBe(true);
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }), t1)).toBe(false);
    expect(needsAttention(app())).toBe(false);
    expect(needsAttention(null)).toBe(false);
    expect(REQUIRED_SLOTS).toEqual(['ID_SELFIE', 'ID_CARD', 'INCOME']);
  });
});
describe('pickableAttachedIds', () => {
  it('returns the source message ids of files not yet sent — a sent file no longer counts as "attached" on the chat bubble', () => {
    const file = (over: Partial<import('./gfin').FinanceFile>) => ({ id: 'f', slot: 'ID_CARD' as const, mimeType: 'image/jpeg', size: 1, originalName: null, source: 'CHAT_MESSAGE' as const, sourceMessageId: 'm1', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '', ...over });
    expect(pickableAttachedIds([file({ sourceMessageId: 'm1', sentAt: null })])).toEqual(['m1']);
    expect(pickableAttachedIds([file({ sourceMessageId: 'm1', sentAt: '2026-09-24T12:00:00Z' })])).toEqual([]);
    expect(pickableAttachedIds([file({ sourceMessageId: null })])).toEqual([]);
    expect(pickableAttachedIds([
      file({ id: 'f1', sourceMessageId: 'm1', sentAt: null }),
      file({ id: 'f2', sourceMessageId: 'm2', sentAt: '2026-09-24T12:00:00Z' }),
    ])).toEqual(['m1']);
  });
});
