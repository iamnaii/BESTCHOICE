import { RepairPayer } from '@prisma/client';

/** Customer-facing PDFs/LINE/LIFF must use this provenance check too. A payer
 * change alone never relabels a retained internal/unknown estimate as a quote. */
export function repairEstimateIsCustomerCharge(ticket: {
  payer: RepairPayer;
  estimatedCostPayer?: RepairPayer | null;
}): boolean {
  return ticket.payer === 'CUSTOMER' && ticket.estimatedCostPayer === 'CUSTOMER';
}
/** Canonical markRepaired writes actualCost and payer together atomically. */
export function repairActualIsCustomerCharge(ticket: { payer: RepairPayer }): boolean {
  return ticket.payer === 'CUSTOMER';
}
