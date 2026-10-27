import { AccessResource, AccessSnapshot, Company, PermissionKey } from '@installment/shared';
import manifest from './access-policy.manifest.json';

export interface RouteAccessPolicy {
  classification: 'staff' | 'self-service' | 'public' | 'customer' | 'integration';
  permission: PermissionKey | null;
  resource: 'domain' | 'none';
  resolution: 'record' | 'collection' | 'none';
  company: string;
  file: string;
  transport: string;
  reason?: string;
  surface?: string;
}
export const ACCESS_POLICIES = manifest as Record<string, RouteAccessPolicy>;
/** A single persisted resource OR an actual scoped collection executor. The latter
 * replaces the unscoped handler: merely registering a company cannot open a list.
 * execute must validate request filters and apply an OR of these original tuples
 * BEFORE pagination/count/aggregate/export, then redact the result. Do not reduce
 * ASSIGNED to branchIds. FINANCE branchIds refer to SHOP-origin records.
 * Resource mutations still recheck current permissions in their DB transaction. */
export interface CollectionScope {
  readonly userId: string;
  readonly company: Company;
  readonly permission: PermissionKey;
  readonly tuples: readonly { scope: 'BRANCHES' | 'ASSIGNED' | 'COMPANY'; branchIds: readonly string[]; userId: string }[];
}
/** reference is safe definition-only data; selection is an exact persisted target set
 * (including an empty set). Both require a mandatory transaction execution wrapper. */
export type AccessDecision =
  | { kind: 'selection'; company: Company; execute: (handler: () => Promise<unknown>) => Promise<unknown> }
  | { kind: 'reference'; company: Company; execute: (handler: () => Promise<unknown>) => Promise<unknown> }
  | { kind: 'resource'; resource: AccessResource; execute?: (handler: () => Promise<unknown>) => Promise<unknown> }
  | { kind: 'collection'; company: Company; execute: (scope: CollectionScope) => Promise<unknown> };
export type AccessBoundary = (request: any, snapshot: AccessSnapshot, permission: PermissionKey) => Promise<AccessDecision>;
export const ACCESS_BOUNDARIES = new Map<string, AccessBoundary>();
