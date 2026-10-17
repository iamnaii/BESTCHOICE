import { AsyncLocalStorage } from 'node:async_hooks';
/** Narrow file-staging seam. A multipart create may defer source authorization
 * until Nest has parsed and validated its body; it must call authorize before
 * staging. All consumers must call execute before any persistent mutation.
 * Uploads happen without an open transaction or the global authority lock. */
export const procurementPreparation = new AsyncLocalStorage<{
  /** Identifies the narrow cash-slip preparer; never derived from request input. */
  source?: 'shop-cash-slip';
  authorize?: () => Promise<void>;
  execute: <T>(handler: () => Promise<T>) => Promise<T>;
}>();
