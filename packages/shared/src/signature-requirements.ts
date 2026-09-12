export type ContractSignerType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';
export interface SignatureRequirement { type: ContractSignerType; label: string; signed: boolean }
export interface SignatureRequirements { complete: boolean; checklist: SignatureRequirement[] }

export function resolveSignatureRequirements(
  signatures: { signerType: string; deletedAt?: Date | string | null }[], requiresGuardian: boolean,
): SignatureRequirements {
  const required: Omit<SignatureRequirement, 'signed'>[] = [
    { type: 'CUSTOMER', label: 'ผู้ซื้อ (ผู้เช่าซื้อ)' }, { type: 'COMPANY', label: 'ผู้ขาย (ผู้ให้เช่าซื้อ)' },
    { type: 'WITNESS_1', label: 'พยาน 1' }, { type: 'WITNESS_2', label: 'พยาน 2' },
    ...(requiresGuardian ? [{ type: 'GUARDIAN' as const, label: 'ผู้ปกครอง' }] : []),
  ];
  const signed = new Set(signatures.filter(row => !row.deletedAt).map(row => row.signerType === 'STAFF' ? 'COMPANY' : row.signerType));
  const checklist = required.map(row => ({ ...row, signed: signed.has(row.type) }));
  return { complete: checklist.every(row => row.signed), checklist };
}
