import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalidate every cache a recorded/posted payment can change.
 *
 * Crucially this includes the per-contract history queries
 * (`contract-payments` / `contract-receipts`, keyed by contractId — matched
 * here by key prefix). They were previously left out, so with the global
 * 3-minute `staleTime` (main.tsx) a warm history cache was served STALE after a
 * payment: "ประวัติการชำระ" showed 0/N + "ไม่พบใบเสร็จ" even though the daily
 * summary (which WAS invalidated) already showed the PAID payment.
 */
export function invalidatePaymentQueries(qc: QueryClient): void {
  const keys = ['pending-payments', 'daily-summary', 'contract-payments', 'contract-receipts'];
  for (const key of keys) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}
