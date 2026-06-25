/** Which customer action a contract-targeting button performs. */
export type ContractAction = 'send-link' | 'contact-log' | 'mdm-lock' | 'view-pdf';

export type ContractTarget<T> =
  | { kind: 'none' }
  | { kind: 'single'; contract: T }
  | { kind: 'pick' };

/**
 * Decide how to run a contract-targeting action given the customer's active
 * contracts: nothing to do, run directly on the only contract, or force the
 * staffer to pick. NEVER silently picks the first of several — a 2-contract
 * customer could otherwise get the WRONG device locked.
 */
export function decideContractTarget<T>(contracts: readonly T[]): ContractTarget<T> {
  if (contracts.length === 0) return { kind: 'none' };
  if (contracts.length === 1) return { kind: 'single', contract: contracts[0] };
  return { kind: 'pick' };
}
