import type { RefObject } from 'react';

interface Options {
  once?: boolean;
  rootMargin?: string;
  stagger?: number;
  childCount?: number;
}

/**
 * Scroll reveal is OFF (owner brief 2026-11-27, B5): content must be visible the moment
 * the page renders — no fade-in, no blank area waiting for the reader to scroll to it.
 * The previous version faded each block up over 650ms from opacity 0, so a fast scroller
 * or a screenshot saw empty sections.
 *
 * The hook stays as a no-op so <Reveal> / <StaggerChildren> callers keep working; it is the
 * one place to turn a reveal back on (keep it ≤150ms and never start from opacity 0).
 */
export function useScrollReveal(
  _ref: RefObject<HTMLDivElement | null>,
  _options: Options = {},
): void {
  // intentionally empty
}
