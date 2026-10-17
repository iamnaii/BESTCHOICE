import { AsyncLocalStorage } from 'node:async_hooks';
/** Narrow file-staging seam: the HTTP boundary already preflighted the source.
 * The service must invoke execute before any persistent mutation. Staged uploads
 * happen without an open DB transaction or the global authority lock. */
export const procurementPreparation = new AsyncLocalStorage<{
  execute: <T>(handler: () => Promise<T>) => Promise<T>;
}>();
