import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { stockInput } from './preflight-fixtures';
import type { SupplierInput } from '../supplier-types';
export async function supplierFixture(db: PrismaClient) {
  const stock = await stockInput(db);
  const ref = 'SUP001';
  const name = 'Synthetic supplier ' + randomUUID();
  const row: SupplierInput = {
    supplierRef: ref,
    displayName: name,
    aliases: [name],
    legalName: name,
    type: 'JURISTIC',
    phone: '020000000',
    lineId: null,
    contactName: null,
    address: 'Synthetic address',
    postalCode: '10000',
    taxId: null,
    branchCode: null,
    hasVat: false,
    creditTermDays: 1,
    bankAccounts: [],
    legalProfileScope: 'GROUP',
    notes: null,
    purchaseVatTerms: null,
    evidenceRefs: [{ workbookSha256: 'a'.repeat(64), sheet: 'ผู้จัดจำหน่าย', row: 5 }],
  };
  return {
    row,
    stock,
    context: {
      canonicalSetId: randomUUID(),
      workbookSha256: 'a'.repeat(64),
      codeRevision: 'c'.repeat(40),
      accessCompanyCode: 'SHOP' as const,
      accessBranchId: stock.rows[0].branchId,
      cutoverAt: '2026-11-22T12:00:00+07:00',
      dbIdentity: stock.expectedDbIdentity,
      matchTargets: {} as Record<string, string>,
    },
  };
}
