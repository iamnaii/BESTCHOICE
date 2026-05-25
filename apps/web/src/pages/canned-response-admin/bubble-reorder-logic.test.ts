import { describe, it, expect } from 'vitest';
import { reorderBubbles } from './bubble-reorder-logic';
import type { CannedResponseBubble } from './types';

const b = (id: string, channels: string[] = []): CannedResponseBubble => ({
  id,
  channels,
  cannedResponseId: 'cr1',
  type: 'TEXT',
  sortOrder: 0,
  text: null,
  mediaUrl: null,
  thumbnailUrl: null,
  stickerPackageId: null,
  stickerId: null,
  createdAt: '',
});

describe('reorderBubbles', () => {
  it('reorders within all-visible context (no filtered hidden bubbles)', () => {
    const all = [b('a'), b('b'), b('c')];
    const result = reorderBubbles(all, 'c', 'a');
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(result.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('preserves hidden bubbles position when reordering filtered (LINE drag with FB hidden)', () => {
    // allBubbles: [A(LINE), X(FB), B(LINE), Y(FB), C(LINE)]
    // LINE tab visible: [A, B, C]
    // User drags C above A in the LINE tab.
    const all = [
      b('a', ['LINE_FINANCE']),
      b('x', ['FACEBOOK']),
      b('b', ['LINE_FINANCE']),
      b('y', ['FACEBOOK']),
      b('c', ['LINE_FINANCE']),
    ];
    const result = reorderBubbles(all, 'c', 'a');
    expect(result.map((r) => r.id)).toEqual(['c', 'a', 'x', 'b', 'y']);

    // LINE-filtered order: [c, a, b] — matches what the user visually dragged.
    const lineOnly = result.filter((r) =>
      all.find((orig) => orig.id === r.id)!.channels.includes('LINE_FINANCE'),
    );
    expect(lineOnly.map((r) => r.id)).toEqual(['c', 'a', 'b']);

    // FB-filtered relative order: [x, y] — preserved, untouched by LINE drag.
    const fbOnly = result.filter((r) =>
      all.find((orig) => orig.id === r.id)!.channels.includes('FACEBOOK'),
    );
    expect(fbOnly.map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('preserves hidden FB bubble between two LINE bubbles when reordering LINE', () => {
    // allBubbles: [A(LINE), X(FB), B(LINE)]
    // LINE tab visible: [A, B]
    // Drag B above A.
    const all = [b('a', ['LINE_FINANCE']), b('x', ['FACEBOOK']), b('b', ['LINE_FINANCE'])];
    const result = reorderBubbles(all, 'b', 'a');
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'x']);

    const lineOnly = result.filter((r) =>
      all.find((orig) => orig.id === r.id)!.channels.includes('LINE_FINANCE'),
    );
    expect(lineOnly.map((r) => r.id)).toEqual(['b', 'a']);

    const fbOnly = result.filter((r) =>
      all.find((orig) => orig.id === r.id)!.channels.includes('FACEBOOK'),
    );
    expect(fbOnly.map((r) => r.id)).toEqual(['x']);
  });

  it('returns identity map when fromIdx === toIdx', () => {
    const all = [b('a'), b('b')];
    const result = reorderBubbles(all, 'a', 'a');
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.map((r) => r.sortOrder)).toEqual([0, 1]);
  });

  it('no-op when activeId not found', () => {
    const all = [b('a'), b('b')];
    const result = reorderBubbles(all, 'missing', 'a');
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('no-op when overId not found', () => {
    const all = [b('a'), b('b')];
    const result = reorderBubbles(all, 'a', 'missing');
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('universal bubbles (channels=[]) coexist with channel-scoped ones', () => {
    // allBubbles: [U1 (universal), A(LINE), U2 (universal), B(LINE)]
    // LINE tab visible: [U1, A, U2, B]
    // Drag B above U1.
    const all = [b('u1'), b('a', ['LINE_FINANCE']), b('u2'), b('b', ['LINE_FINANCE'])];
    const result = reorderBubbles(all, 'b', 'u1');
    expect(result.map((r) => r.id)).toEqual(['b', 'u1', 'a', 'u2']);
  });
});
